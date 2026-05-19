"use server";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { getOrSyncCurrentUser } from "@/lib/admin";
import { getStripe } from "@/lib/stripe";

const HAS_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"] as const;
const STRIPE_HAS_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
]);

export async function startCheckout(formData: FormData) {
  const plan = formData.get("plan");
  if (plan !== "monthly" && plan !== "annual") {
    throw new Error("Invalid plan");
  }

  // getOrSyncCurrentUser handles the race where Clerk's user.created webhook
  // hasn't landed before a brand-new signup hits Subscribe. If we still come
  // back empty here something is wrong with auth — bounce to home, proxy
  // will redirect to sign-in on the next request.
  const user = await getOrSyncCurrentUser();
  if (!user) redirect("/");
  const userId = user.id;

  // Layer 1: prevent duplicate subscriptions from our DB mirror.
  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...HAS_SUBSCRIPTION_STATUSES]),
      ),
    )
    .limit(1);
  if (existing) redirect("/");

  const priceId =
    plan === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY
      : process.env.STRIPE_PRICE_ANNUAL;
  if (!priceId) {
    throw new Error(`Stripe price for ${plan} not configured`);
  }

  const stripe = getStripe();

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId },
    });
    customerId = customer.id;
    await db
      .update(users)
      .set({ stripeCustomerId: customerId })
      .where(eq(users.id, userId));
  }

  // Layer 2: source-of-truth check against Stripe. Catches the race where
  // our DB mirror is behind because the previous customer.subscription.created
  // webhook hasn't landed yet.
  const stripeSubs = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 5,
  });
  if (stripeSubs.data.some((s) => STRIPE_HAS_SUBSCRIPTION_STATUSES.has(s.status))) {
    redirect("/");
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // If the user came from a watch flow, carry show+resume through so we can
  // drop them back into playback after Stripe Checkout.
  const showSlug = formData.get("show");
  const resume = formData.get("resume");
  // No /account page anymore — Stripe Checkout success lands back on the
  // catalog. If the user came from a watch flow, the override below sends
  // them straight back into playback.
  let successUrl = `${origin}/?welcome=1`;
  if (typeof showSlug === "string" && showSlug) {
    const watchParams = new URLSearchParams();
    if (typeof resume === "string" && resume) watchParams.set("resume", resume);
    const qs = watchParams.toString();
    successUrl = `${origin}/watch/${encodeURIComponent(showSlug)}${qs ? `?${qs}` : ""}`;
  }
  const cancelParams = new URLSearchParams();
  if (typeof showSlug === "string" && showSlug) cancelParams.set("show", showSlug);
  if (typeof resume === "string" && resume) cancelParams.set("resume", resume);
  const cancelQs = cancelParams.toString();
  const cancelUrl = `${origin}/subscribe${cancelQs ? `?${cancelQs}` : ""}`;

  // Idempotency key dedupes parallel-tab clicks: two simultaneous
  // submissions for the same (user, plan) inside the same hour bucket
  // return the same Checkout session from Stripe, so the user can only
  // ever complete one subscription per intent. Layer 1 + Layer 2 above
  // catch most cases but neither is atomic with sessions.create.
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  const idempotencyKey = `checkout:${userId}:${plan}:${hourBucket}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: { metadata: { userId } },
    },
    { idempotencyKey },
  );

  if (!session.url) throw new Error("Stripe did not return a session URL");
  redirect(session.url);
}
