import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";

// Webhooks run on Node, not Edge — verifyWebhook needs the raw request body
// and we hit Postgres via postgres-js.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Clerk webhook signature verification failed:", err);
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

  return new Response("OK", { status: 200 });
}
