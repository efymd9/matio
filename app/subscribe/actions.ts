"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { shows, subscriptions, users } from "@/db/schema";
import { getOrSyncCurrentUser } from "@/lib/admin";
import {
  readAttributionCookies,
  toStripeMetadata,
} from "@/lib/attribution";
import { getStripe } from "@/lib/stripe";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";

const STRIPE_HAS_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
]);

export async function startCheckout(formData: FormData) {
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
        inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
      ),
    )
    .limit(1);
  if (existing) redirect("/");

  const priceId = process.env.STRIPE_PRICE_MONTHLY;
  if (!priceId) {
    throw new Error("Stripe price for monthly not configured");
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

  // If the user came from a watch flow, carry show+resume through so we
  // can drop them back into playback after Stripe Checkout.
  const showSlugRaw = formData.get("show");
  const resume = formData.get("resume");

  // Validate the slug against an actual published show before letting it
  // shape any redirect URL. Without this, formData.show is attacker-
  // controlled input that flows into the Stripe-hosted Checkout page's
  // cancel link and the post-payment success URL — both surfaces a user
  // (or anti-phishing scanner) would inspect. A bad slug would also 404
  // the user after a successful payment.
  let showSlug: string | null = null;
  if (typeof showSlugRaw === "string" && showSlugRaw) {
    const [match] = await db
      .select({ slug: shows.slug })
      .from(shows)
      .where(
        and(
          eq(shows.slug, showSlugRaw),
          eq(shows.status, "published"),
          isNull(shows.deletedAt),
        ),
      )
      .limit(1);
    if (match) showSlug = match.slug;
  }

  // No /account page anymore — Stripe Checkout success lands back on the
  // catalog. If the user came from a watch flow, the override below sends
  // them straight back into playback.
  let successUrl = `${origin}/?welcome=1`;
  if (showSlug) {
    const watchParams = new URLSearchParams();
    if (typeof resume === "string" && resume) watchParams.set("resume", resume);
    const qs = watchParams.toString();
    successUrl = `${origin}/watch/${encodeURIComponent(showSlug)}${qs ? `?${qs}` : ""}`;
  }
  const cancelParams = new URLSearchParams();
  if (showSlug) cancelParams.set("show", showSlug);
  if (typeof resume === "string" && resume) cancelParams.set("resume", resume);
  const cancelQs = cancelParams.toString();
  const cancelUrl = `${origin}/subscribe${cancelQs ? `?${cancelQs}` : ""}`;

  // Idempotency key dedupes parallel-tab clicks: two simultaneous
  // submissions inside the same hour bucket return the same Checkout
  // session from Stripe, so the user can only ever complete one
  // subscription per intent. Layer 1 + Layer 2 above catch most cases
  // but neither is atomic with sessions.create.
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  const idempotencyKey = `checkout:${userId}:${hourBucket}`;

  // Snapshot the user's UTM cookies and ship them through Stripe so the
  // webhook can stamp them onto the subscription row. This is the cut
  // marketing wants — "which campaign produced this paid sub?" — at the
  // exact conversion moment, independent of the user-level first-touch.
  const attribution = await readAttributionCookies();
  const attributionMetadata = toStripeMetadata(
    attribution.first,
    attribution.last,
  );

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: { metadata: { userId, ...attributionMetadata } },
    },
    { idempotencyKey },
  );

  if (!session.url) throw new Error("Stripe did not return a session URL");
  redirect(session.url);
}
