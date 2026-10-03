import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { eraseUser } from "@/lib/erase-user";
import { describeError } from "@/lib/observability";
import { getPosthogQueryConfig } from "@/lib/posthog-config";
import { getStripe } from "@/lib/stripe";

// The ONE write of a Clerk account's `users` mirror row, shared by the Clerk
// `user.created` webhook and lib/admin.ts:getOrSyncCurrentUser (#380).
//
// `ON CONFLICT (id) DO NOTHING` makes a repeat harmless: once the row exists,
// a webhook redelivery or a second sync inserts nothing and never reaches the
// branch below. What it does NOT absorb is `users_email_unique`: the address
// already held by a row under ANOTHER Clerk id. Two ways that happens, both
// gaps in our mirroring rather than in Clerk (which keeps an address unique):
//   1. the account was deleted at Clerk without our erasure — the production
//      endpoint is not subscribed to `user.deleted` (#172) — and the person
//      signed up again with the same address;
//   2. the address was changed at Clerk — `user.updated` is not mirrored
//      (docs/registry.md) — and somebody else signed up with the old one.
// Before #380 the insert threw: the webhook answered 500 forever and the new
// account never got a row (no progress saves, no checkout, /v1/progress 503).
//
// So a conflict asks Clerk about the row's own id, and only Clerk decides:
//   · 404 — that account is gone; the row is what an erasure that never ran
//     left behind. It is erased with lib/erase-user.ts:eraseUser — the very
//     code `user.deleted` would have run, every step and every log line by id
//     (ст. 17) — and the insert is repeated.
//   · alive, and the address is no longer among its addresses — the mirror is
//     stale (path 2): the row gets the account's CURRENT primary address,
//     guarded by the old one in the WHERE, and the insert is repeated. If that
//     address is itself taken, nothing cascades — the conflict is reported.
//   · alive and still holding the address (Clerk should never allow it), or
//     alive with no address at all — nothing is touched; reported.
//   · Clerk answers anything else (5xx, timeout, a bad key) — nothing is
//     erased on a guess; the caller retries later (the webhook answers 500 so
//     Svix redelivers).
// Every outcome is reported by ids and statuses only — to the log and to
// Sentry, because Vercel logs live a day — never the address
// (lib/log-audit.test.ts).

/** The unique constraint on users.email (drizzle/0000_cold_shinobi_shaw.sql). */
export const USERS_EMAIL_UNIQUE = "users_email_unique";

export type MirrorUserResult =
  | {
      status: "mirrored";
      /** How a conflict on the address was resolved; absent when there was none. */
      resolved?: "stale_row_erased" | "stale_address_corrected";
    }
  | {
      /** Reported by id; retrying would change nothing. */
      status: "unresolved";
      reason: "address_still_owned" | "holder_has_no_address" | "current_address_taken";
    }
  | {
      /** Clerk could not be asked — nothing touched, try again later. */
      status: "clerk_unavailable";
    };

/** The two fields of a Clerk user this code reads (Backend API `User`). */
export type ClerkUserLike = {
  primaryEmailAddress: { emailAddress: string } | null;
  emailAddresses: { emailAddress: string }[];
};

/** The account's primary address, or its first one. */
export function clerkPrimaryEmail(user: ClerkUserLike | null): string | undefined {
  return (
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress
  );
}

type Outcome =
  | "stale_row_erased"
  | "stale_address_corrected"
  | "address_still_owned"
  | "holder_has_no_address"
  | "current_address_taken"
  | "clerk_unavailable";

const MESSAGES: Record<Outcome, string> = {
  stale_row_erased:
    "users mirror: the address was held by the row of a Clerk account that no longer exists — erased it, as user.deleted would have (#380)",
  stale_address_corrected:
    "users mirror: the address was held by a live account whose address changed at Clerk — its row now carries its current address (#380)",
  address_still_owned:
    "users mirror: the address belongs to another LIVE Clerk account — nothing touched, the new account has no users row (#380)",
  holder_has_no_address:
    "users mirror: the address is held by a live Clerk account that has no address any more — nothing touched, the new account has no users row (#380)",
  current_address_taken:
    "users mirror: the stale row's current Clerk address is itself taken — nothing touched, the new account has no users row (#380)",
  clerk_unavailable:
    "users mirror: Clerk could not be asked about the address holder — nothing erased, retry later (#380)",
};

function report(
  outcome: Outcome,
  ids: { userId: string; holderId: string },
  details: Record<string, unknown> = {},
) {
  const resolved =
    outcome === "stale_row_erased" || outcome === "stale_address_corrected";
  (resolved ? console.warn : console.error)(MESSAGES[outcome], {
    ...ids,
    outcome,
    ...details,
  });
  Sentry.captureMessage(MESSAGES[outcome], {
    level: resolved ? "warning" : "error",
    tags: { ...ids, outcome },
  });
}

// Clerk's Backend API errors (ClerkAPIResponseError) carry the HTTP status as
// `status` — read structurally, like app/api/v1/account/delete/route.ts.
function clerkHttpStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

/** true = the row is there; false = the address is held by another row. */
async function insertMirrorRow(userId: string, email: string): Promise<boolean> {
  try {
    await db
      .insert(users)
      .values({ id: userId, email })
      .onConflictDoNothing({ target: users.id });
    return true;
  } catch (err) {
    if (isUniqueViolation(err, USERS_EMAIL_UNIQUE)) return false;
    throw err;
  }
}

/**
 * The repeat after a resolution. One attempt only: losing the address again
 * in the same breath is a race worth a retry from the caller (the webhook's
 * 500 → Svix), not a loop here — so the driver error propagates.
 */
async function insertAgain(userId: string, email: string) {
  await db
    .insert(users)
    .values({ id: userId, email })
    .onConflictDoNothing({ target: users.id });
}

export async function mirrorClerkUser(
  userId: string,
  email: string,
): Promise<MirrorUserResult> {
  if (await insertMirrorRow(userId, email)) return { status: "mirrored" };

  const [holder] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!holder || holder.id === userId) {
    // The holder left between the two statements (a concurrent erasure), or
    // it IS this account (the webhook and a sync inserting at once).
    await insertAgain(userId, email);
    return { status: "mirrored" };
  }
  const ids = { userId, holderId: holder.id };

  let account: ClerkUserLike | null;
  try {
    account = await (await clerkClient()).users.getUser(holder.id);
  } catch (err) {
    const httpStatus = clerkHttpStatus(err);
    if (httpStatus !== 404) {
      // Never the message: Clerk's errors quote what they are about.
      report("clerk_unavailable", ids, { httpStatus, error: describeError(err) });
      return { status: "clerk_unavailable" };
    }
    account = null;
  }

  if (account === null) {
    const erased = await eraseUser(holder.id, {
      db,
      getStripe,
      posthog: getPosthogQueryConfig(),
    });
    report("stale_row_erased", ids, { erase: erased.status });
    await insertAgain(userId, email);
    return { status: "mirrored", resolved: "stale_row_erased" };
  }

  const wanted = email.toLowerCase();
  if (account.emailAddresses.some((a) => a.emailAddress.toLowerCase() === wanted)) {
    report("address_still_owned", ids);
    return { status: "unresolved", reason: "address_still_owned" };
  }
  const current = clerkPrimaryEmail(account);
  if (!current) {
    report("holder_has_no_address", ids);
    return { status: "unresolved", reason: "holder_has_no_address" };
  }
  try {
    await db
      .update(users)
      .set({ email: current })
      .where(and(eq(users.id, holder.id), eq(users.email, email)));
  } catch (err) {
    if (!isUniqueViolation(err, USERS_EMAIL_UNIQUE)) throw err;
    report("current_address_taken", ids);
    return { status: "unresolved", reason: "current_address_taken" };
  }
  report("stale_address_corrected", ids);
  await insertAgain(userId, email);
  return { status: "mirrored", resolved: "stale_address_corrected" };
}
