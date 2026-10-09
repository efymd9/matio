import { clerkClient } from "@clerk/nextjs/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { describeDbError } from "@/lib/db-errors";
import { eraseUser, type EraseUserResult } from "@/lib/erase-user";
import { describeError } from "@/lib/observability";
import { getPosthogQueryConfig } from "@/lib/posthog-config";
import { getStripe } from "@/lib/stripe";
import { clerkHttpStatus, mirrorClerkUser } from "@/lib/user-mirror";

// Webhooks run on Node, not Edge — verifyWebhook needs the raw request body
// and we hit Postgres via postgres-js.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Clerk webhook signature verification failed:", {
      error: describeError(err),
    });
    return new Response("Bad signature", { status: 400 });
  }

  if (evt.type === "user.created") {
    const data = evt.data;
    const email =
      data.email_addresses.find((e) => e.id === data.primary_email_address_id)
        ?.email_address ?? data.email_addresses[0]?.email_address;

    if (!email) {
      // No email to mirror. Real email-signup users always have one;
      // this hits for Clerk's "Send Example" test payload and any
      // phone/username-only signup. Acknowledge with 200 so Clerk
      // doesn't retry an event we can't act on — getOrSyncCurrentUser
      // backfills the row on the first authenticated /subscribe hit
      // regardless.
      console.warn("user.created event has no email — skipping", {
        id: data.id,
      });
      return new Response("OK (no email, skipped)", { status: 200 });
    }

    // A late delivery must not resurrect an erased account (#336 (b)). Svix
    // redelivers a failed `user.created` for hours or days; meanwhile the
    // account may have got its row through a heal (getOrSyncCurrentUser) and
    // been deleted — the row erased with it. Inserting now would put the
    // address back after the erasure. Clerk is the source of truth on whether
    // the account still exists, so it is asked first — no tombstone of our
    // own. Sign-ups are rare; one more Clerk read on each costs nothing.
    //   · 404 — the account is gone: nothing is written, logged by id, 200
    //     (a redelivery would find the same answer);
    //   · any other failure — nothing is written, 500 so Svix redelivers.
    // Only here: getOrSyncCurrentUser already proves the account through
    // currentUser() before it writes.
    try {
      await (await clerkClient()).users.getUser(data.id);
    } catch (err) {
      const httpStatus = clerkHttpStatus(err);
      if (httpStatus === 404) {
        console.warn("user.created for a deleted account — skipped", {
          id: data.id,
        });
        return new Response("OK (account deleted, skipped)", { status: 200 });
      }
      // Never the message: Clerk's errors quote what they are about.
      console.error(
        "user.created: Clerk could not say whether the account still exists — nothing written, retry",
        { id: data.id, httpStatus, error: describeError(err) },
      );
      return new Response("Clerk unavailable — retry", { status: 500 });
    }

    // Idempotent (ON CONFLICT (id) DO NOTHING — Clerk retries failed
    // webhooks); an address already held by another row is resolved there
    // (#380, lib/user-mirror.ts). A conflict that cannot be resolved is
    // reported by id and acknowledged — a redelivery would change nothing;
    // Clerk being unreachable is a 500, so Svix redelivers.
    // Clerk always sends created_at; "now" is a safe stand-in otherwise —
    // no row can be newer than the moment it is used as a bound.
    const createdAt =
      typeof data.created_at === "number" ? new Date(data.created_at) : new Date();
    const result = await mirrorClerkUser(data.id, email, createdAt);
    if (result.status === "clerk_unavailable") {
      return new Response("Clerk unavailable — retry", { status: 500 });
    }
    if (result.status === "unresolved") {
      return new Response("OK (address conflict unresolved)", { status: 200 });
    }
  }

  if (evt.type === "user.deleted") {
    // Art. 17 GDPR. Clerk is the source of truth for the account: deleting
    // it there is the ONE trigger, and lib/erase-user.ts is the ONE
    // mechanism — shared with `pnpm erase-user <id> --apply` for the day
    // this webhook did not arrive. The payload carries only the id (no
    // email). Anything the erasure throws (the tombstone write, a DELETE —
    // the database is the only thing it throws for) becomes a 500 on
    // purpose: Clerk retries, and the retry converges. It is answered here
    // rather than left to the framework (#350): the runtime log gets id,
    // class and SQLSTATE only — never the error, whose text is the
    // statement. Sentry gets the error itself, for its stack: the by-address
    // DELETEs throw it already redacted (withRedactedFailure), the other
    // statements bind ids only, and the scrubbers cut params and addresses
    // from whatever is sent (lib/log-audit.test.ts drives both shapes).
    const userId = evt.data.id;
    if (!userId) {
      // Clerk's "Send Example" payload and any malformed delivery: nothing
      // to act on and nothing a retry would fix — acknowledge (same stance
      // as the emailless user.created above).
      console.warn("user.deleted event has no id — skipping");
      return new Response("OK (no id, skipped)", { status: 200 });
    }
    let result: EraseUserResult;
    try {
      result = await eraseUser(userId, {
        db,
        getStripe,
        posthog: getPosthogQueryConfig(),
      });
    } catch (err) {
      const { name, code } = describeDbError(err);
      console.error("user.deleted: erasure failed — 500, Clerk retries", {
        userId,
        name,
        code,
      });
      Sentry.captureException(err, {
        level: "error",
        tags: { userId, code: code ?? "none", name },
      });
      return new Response("Erasure failed — retry", { status: 500 });
    }
    // Already erased (Clerk redelivers on timeouts) or never mirrored —
    // either way the end state holds. Idempotent 200.
    return new Response(
      result.status === "not_found" ? "OK (already erased)" : "OK",
      { status: 200 },
    );
  }

  return new Response("OK", { status: 200 });
}
