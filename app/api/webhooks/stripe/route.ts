import type Stripe from "stripe";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { getStripe } from "@/lib/stripe";

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
  paused: "canceled",
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

  // current_period_end moved to per-item in newer Stripe API versions.
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000)
    : new Date();

  await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      stripeSubscriptionId: sub.id,
      status: STATUS_MAP[sub.status],
      plan,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        status: STATUS_MAP[sub.status],
        plan,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });
}

async function mirrorInvoiceSubscription(invoice: Stripe.Invoice) {
  const ref = invoice.parent?.subscription_details?.subscription;
  if (!ref) return; // non-subscription invoice (manual, etc.)
  const subId = typeof ref === "string" ? ref : ref.id;
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

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await mirrorSubscription(event.data.object);
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
        await mirrorInvoiceSubscription(event.data.object);
        break;
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
