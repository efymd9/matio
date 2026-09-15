import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eraseUser } from "@/lib/erase-user";
import { describeError } from "@/lib/observability";
import { getPosthogQueryConfig } from "@/lib/posthog-config";
import { getStripe } from "@/lib/stripe";

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

    // onConflictDoNothing makes this idempotent — Clerk retries failed webhooks.
    await db
      .insert(users)
      .values({ id: data.id, email })
      .onConflictDoNothing({ target: users.id });
  }

  if (evt.type === "user.deleted") {
    // Art. 17 GDPR. Clerk is the source of truth for the account: deleting
    // it there is the ONE trigger, and lib/erase-user.ts is the ONE
    // mechanism — shared with `pnpm erase-user <id> --apply` for the day
    // this webhook did not arrive. The payload carries only the id (no
    // email). Anything the erasure throws (the tombstone write failing)
    // becomes a 500 on purpose: Clerk retries, and the retry converges.
    const userId = evt.data.id;
    if (!userId) {
      // Clerk's "Send Example" payload and any malformed delivery: nothing
      // to act on and nothing a retry would fix — acknowledge (same stance
      // as the emailless user.created above).
      console.warn("user.deleted event has no id — skipping");
      return new Response("OK (no id, skipped)", { status: 200 });
    }
    const result = await eraseUser(userId, {
      db,
      getStripe,
      posthog: getPosthogQueryConfig(),
    });
    // Already erased (Clerk redelivers on timeouts) or never mirrored —
    // either way the end state holds. Idempotent 200.
    return new Response(
      result.status === "not_found" ? "OK (already erased)" : "OK",
      { status: 200 },
    );
  }

  return new Response("OK", { status: 200 });
}
