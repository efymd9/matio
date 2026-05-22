import type Stripe from "stripe";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stripeEvents, subscriptions, users } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { markUserTrialsConverted } from "@/lib/trial";

// Stripe needs the raw body to verify the signature; DB writes hit postgres-js.
// Both want Node runtime.
export const runtime = "nodejs";

const STATUS_MAP: Record<
  Stripe.Subscription.Status,
  "active" | "past_due" | "canceled" | "trialing"
> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "past_due",
  canceled: "canceled",
  incomplete: "canceled",
  incomplete_expired: "canceled",
  // Stripe's Customer Portal "pause payment collection" feature drops the
  // sub into paused. We map to past_due (access-granting) so a customer
  // who pauses for a trip doesn't lose playback the moment they pause —
  // they're still a subscriber, billing is just suspended.
  paused: "past_due",
};

function planFromPriceId(
  priceId: string | undefined,
): "monthly" | "annual" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_ANNUAL) return "annual";
  return null;
}

async function mirrorSubscription(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  if (!user) {
    console.warn("Stripe webhook: no local user for customer", { customerId });
    return;
  }

  const item = sub.items.data[0];
  const plan = planFromPriceId(item?.price.id);
  if (!plan) {
    console.warn("Stripe webhook: unknown plan for subscription", {
      subId: sub.id,
      priceId: item?.price.id,
    });
    return;
  }

  const mappedStatus = STATUS_MAP[sub.status];

  // current_period_end moved to per-item in newer Stripe API versions.
  // For access-granting statuses it is mandatory: defaulting to now()
  // would make the gate `currentPeriodEnd > now()` evaluate false the
  // instant we wrote the row, locking a just-paid user out of the
  // product they paid for. Throw so Stripe retries; the field is
  // typically present by the second delivery. For canceled-track
  // statuses (canceled / incomplete / incomplete_expired) the field
  // may legitimately be absent — store the epoch so the gate is
  // definitely false without an explicit branch.
  const grantsAccess =
    mappedStatus === "active" ||
    mappedStatus === "trialing" ||
    mappedStatus === "past_due";
  if (grantsAccess && !item?.current_period_end) {
    throw new Error(
      `Stripe subscription ${sub.id} status=${sub.status} missing current_period_end`,
    );
  }
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : new Date(0);

  // The Customer Portal sets sub.cancel_at (a timestamp), not the legacy
  // cancel_at_period_end boolean — treat either as "scheduled to cancel".
  const cancelScheduled =
    sub.cancel_at_period_end || sub.cancel_at != null;

  await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      stripeSubscriptionId: sub.id,
      status: mappedStatus,
      plan,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: cancelScheduled,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        status: mappedStatus,
        plan,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: cancelScheduled,
        updatedAt: new Date(),
      },
    });

  // Once the user has an active (or trialing) subscription, flip every trial
  // session they own to converted = true so the playback path stops gating.
  if (mappedStatus === "active" || mappedStatus === "trialing") {
    await markUserTrialsConverted(user.id);
  }
}

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
