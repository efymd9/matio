import type Stripe from "stripe";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stripeEvents } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { mirrorSubscription } from "@/lib/subscription-mirror";

// Stripe needs the raw body to verify the signature; DB writes hit postgres-js.
// Both want Node runtime.
export const runtime = "nodejs";

// mirrorSubscription lives in lib/subscription-mirror.ts — shared with the
// /welcome guest-checkout success page, which runs the same idempotent
// mirror inline to close the webhook-vs-redirect race. Route files can only
// export HTTP handlers, hence the module split.

async function mirrorInvoiceSubscription(invoice: Stripe.Invoice) {
  const ref = invoice.parent?.subscription_details?.subscription;
  if (!ref) return; // non-subscription invoice (manual, etc.)
  const subId = typeof ref === "string" ? ref : ref.id;
  const sub = await getStripe().subscriptions.retrieve(subId);
  await mirrorSubscription(sub);
}

async function mirrorCheckoutSession(session: Stripe.Checkout.Session) {
  // Only subscription-mode sessions are relevant to our access model.
  if (session.mode !== "subscription") return;
  const ref = session.subscription;
  const subId = typeof ref === "string" ? ref : ref?.id;
  if (!subId) return;
  // checkout.session.completed often arrives before
  // customer.subscription.created (Stripe routes them through different
  // pipelines and the order is not guaranteed). Retrieve the subscription
  // and mirror it now so the user lands on /watch with a row already in
  // place — otherwise they get a 403 on the access-granting check until
  // the second event arrives.
  const sub = await getStripe().subscriptions.retrieve(subId);
  await mirrorSubscription(sub);
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const body = await req.text();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not set");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  // Idempotency: claim the event row before processing. If the INSERT
  // returns no row, this event_id has already been processed (or is
  // mid-processing on another instance) — either way it's safe to 200-OK
  // without re-applying state. Stripe retries with backoff on non-2xx, so
  // a replayed delete after a re-subscribe was previously able to flip
  // an active sub back to canceled; the unique constraint stops that.
  const claimed = await db
    .insert(stripeEvents)
    .values({ eventId: event.id })
    .onConflictDoNothing({ target: stripeEvents.eventId })
    .returning({ eventId: stripeEvents.eventId });
  if (claimed.length === 0) {
    return new Response("OK", { status: 200 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await mirrorSubscription(event.data.object);
        break;
      case "checkout.session.completed":
        await mirrorCheckoutSession(event.data.object);
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        await mirrorInvoiceSubscription(event.data.object);
        break;
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    // Roll back the idempotency claim so Stripe's retry can re-attempt.
    // Without this, a transient DB failure would leave the event marked
    // processed even though we didn't actually apply the state change.
    await db
      .delete(stripeEvents)
      .where(eq(stripeEvents.eventId, event.id));
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
