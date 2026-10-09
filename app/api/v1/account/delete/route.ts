import { auth, clerkClient } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { DeleteAccountResponse } from "@/lib/api/types";
import { apiError, apiOk } from "@/lib/api/v1";
import {
  appleAuthorizationCode,
  revokeAppleAuthorization,
  type AppleRevocation,
} from "@/lib/apple-revoke";
import { clerkTokenInHeader } from "@/lib/authorized-parties";
import { eraseUser, type EraseUserResult } from "@/lib/erase-user";
import { describeError } from "@/lib/observability";
import { getPosthogQueryConfig } from "@/lib/posthog-config";
import { getStripe } from "@/lib/stripe";

// POST /api/v1/account/delete — «Delete account» in the app (art. 17 GDPR,
// App Store 5.1.1(v), #309).
//
// A new trigger, not a new mechanism: the erasure is lib/erase-user.ts:
// eraseUser — the code the Clerk `user.deleted` webhook and `pnpm erase-user
// --apply` run (a live Stripe subscription set to cancel at period end, the
// customer tombstones, the reminder rows, the users row and its cascades, the
// PostHog person). What this route owns is the order and the Clerk half:
//
//   1. eraseUser — our side FIRST. It throws only when the database does (the
//      tombstone insert, a DELETE); the route then answers 500 and leaves the
//      Clerk account alone, so the viewer is still signed in and can retry,
//      and the retry converges (eraseUser is idempotent — its module comment).
//      The reverse order would strand data: a Clerk account deleted first is a
//      session gone — no retry from the app — and the webhook that would
//      finish the job is not subscribed to `user.deleted` in production
//      (docs/registry.md). This route must not depend on it.
//   1b. Apple — for an account that signed in with Apple, the app sends a
//      fresh authorization code with the request (#407, App Store 5.1.1(v));
//      lib/apple-revoke.ts exchanges it and revokes the grant. Only once our
//      side is erased: a deletion that stops at step 1 leaves the account AND
//      its Apple grant, and the retry brings a new code (one use, five
//      minutes). Best-effort — whatever Apple answers, step 2 runs; a failure
//      is logged and sent to Sentry by id. No code (an account without Apple,
//      an older build, a cancelled sheet) or no Apple key in the env is a
//      typed skip, and the deletion is exactly what it was before #407.
//   2. Clerk `users.deleteUser` — the account and its sessions. A 404 is
//      success: a double tap, a lost response retried, or the dashboard got
//      there first. Any other failure is 500 with our side already erased; the
//      session still works, and a retry runs eraseUser again (its not-found
//      path writes nothing locally and repeats only the PostHog step) and then
//      Clerk. That 500 runs step 3 first: a timeout or a 5xx does not prove
//      Clerk kept the account — if the delete committed, the session is dead,
//      no retry will come, and nothing else would erase a healed row.
//   3. The sweep: one more look at `users`. Between steps 1 and 2 the account
//      still existed at Clerk, and /v1/progress heals a missing mirror row
//      FROM Clerk (#303, getOrSyncCurrentUser) — a save landing in that
//      window would put the row, address and all, back. After step 2 that
//      heal can no longer write (Clerk answers 404 to its read), so a row
//      found now is erased again by the same eraseUser. A sweep that fails
//      does not undo the deletion the viewer asked for — it is shouted by id
//      for the operator (`pnpm erase-user <id> --apply`, runbook §4). A late
//      `user.created` redelivery writes nothing — the webhook asks Clerk
//      first and a 404 skips it — and the app asks Clerk about its session
//      when this answer is lost (#336). What is left — a heal that read Clerk
//      before step 2 and inserts after this look (milliseconds; closed by the
//      `user.deleted` webhook, #172) and a Stripe cancel that failed under an
//      `ok` — is tracked in #336.
//   4. Where Clerk's `user.deleted` webhook is subscribed, it arrives after
//      step 2 and takes eraseUser's same not-found path: a 200 no-op.
//
// Bearer-only, literally: the session must come from the Authorization header
// (the app's @clerk/expo token). A browser cookie session is refused even
// though auth() would accept it — web deletion is not this route's job
// (docs/registry.md), and a header-only route leaves no cross-site request
// that could carry the cookie. A stolen Bearer token can delete the account:
// that is inherent to self-service deletion, and no more than the token
// already controls.
//
// Logs carry ids and statuses only (lib/log-audit.test.ts): eraseUser reads the
// address, and vendors quote what they were sent.

export const runtime = "nodejs";
// Every vendor step inside is bounded — the Stripe cancellation ≈17s at worst
// with its retries, the customer search, each PostHog request and each of
// Apple's two requests 5s — so the budget is stated rather than left to the
// plan's default.
export const maxDuration = 60;

const FAILED = "Couldn't delete your account. Please try again.";

export async function POST(req: NextRequest) {
  // Nothing is read or written for a caller without a Bearer session. When a
  // header token is present Clerk verifies THAT and never the cookie
  // (clerkTokenInHeader mirrors its parser), so auth() below is the header's.
  if (clerkTokenInHeader(req.headers.get("authorization")) === undefined) {
    return apiError("unauthorized", "Sign in to delete your account.");
  }
  const { userId } = await auth();
  if (!userId) {
    return apiError("unauthorized", "Sign in to delete your account.");
  }

  let erase: EraseUserResult["status"];
  try {
    erase = (
      await eraseUser(userId, { db, getStripe, posthog: getPosthogQueryConfig() })
    ).status;
  } catch (err) {
    // Never the message: the driver quotes the statement, the address in it.
    console.error(
      "account delete: erasure FAILED — the Clerk account was kept so the viewer can retry",
      { userId, error: describeError(err) },
    );
    Sentry.captureMessage("account delete: erasure failed — Clerk account kept", {
      level: "error",
      tags: { userId, step: "erase" },
    });
    return apiError("server_error", FAILED);
  }

  const apple = await revokeApple(userId, req);

  let clerk: "deleted" | "already_gone";
  try {
    await (await clerkClient()).users.deleteUser(userId);
    clerk = "deleted";
  } catch (err) {
    const httpStatus = clerkHttpStatus(err);
    if (httpStatus !== 404) {
      // Step 3 even here — see the comment at the top.
      const sweep = await sweepHealedRow(userId);
      console.error(
        "account delete: our data is erased but the Clerk account could NOT be deleted — a retry finishes it",
        { userId, erase, apple, httpStatus, sweep, error: describeError(err) },
      );
      Sentry.captureMessage(
        "account delete: Clerk account NOT deleted after the erasure",
        { level: "error", tags: { userId, step: "clerk" } },
      );
      return apiError("server_error", FAILED);
    }
    clerk = "already_gone";
  }

  const sweep = await sweepHealedRow(userId);
  console.info("account delete: done", { userId, erase, apple, clerk, sweep });
  const body: DeleteAccountResponse = { ok: true };
  return apiOk(body);
}

// Step 1b. The body is read only here, after the session was checked: an old
// build sends none, and an unreadable one is the same «no code» — it never
// fails the deletion. The result carries no token and no code, so it is
// logged as is.
async function revokeApple(userId: string, req: NextRequest): Promise<AppleRevocation> {
  const body: unknown = await req.json().catch(() => undefined);
  const apple = await revokeAppleAuthorization(appleAuthorizationCode(body));
  if (apple.status === "failed") {
    Sentry.captureMessage("account delete: Apple token revocation failed", {
      level: "warning",
      tags: { userId, step: "apple", appleStep: apple.step },
    });
  }
  return apple;
}

// Step 3: one more look at `users`; a row found is erased again by the same
// eraseUser. Never throws — its failure is the operator's (log + Sentry by id).
async function sweepHealedRow(
  userId: string,
): Promise<"clean" | "erased_again" | "failed"> {
  try {
    const [back] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!back) return "clean";
    await eraseUser(userId, { db, getStripe, posthog: getPosthogQueryConfig() });
    return "erased_again";
  } catch (err) {
    console.error(
      "account delete: the sweep for a healed users row FAILED — run pnpm erase-user <id> --apply (docs/runbooks/gdpr-requests.md §4)",
      { userId, error: describeError(err) },
    );
    Sentry.captureMessage("account delete: post-Clerk sweep failed — erase by hand", {
      level: "error",
      tags: { userId, step: "sweep" },
    });
    return "failed";
  }
}

// Clerk's Backend API errors (ClerkAPIResponseError, thrown by @clerk/backend's
// request wrapper) carry the HTTP status as `status`. Read structurally, the
// way describeError reads the other vendors' errors.
function clerkHttpStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}
