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
      console.error("user.created event missing email", { id: data.id });
      return new Response("Missing email", { status: 400 });
    }

    // onConflictDoNothing makes this idempotent — Clerk retries failed webhooks.
    await db
      .insert(users)
      .values({ id: data.id, email })
      .onConflictDoNothing({ target: users.id });
  }

  return new Response("OK", { status: 200 });
}
