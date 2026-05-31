"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { shows, subscriptions, users } from "@/db/schema";
import { getOrSyncCurrentUser } from "@/lib/admin";
import {
  readAttributionCookies,
  toStripeMetadata,
} from "@/lib/attribution";
import {
  type CapiIdentity,
  readCapiIdentity,
  toCapiMetadata,
} from "@/lib/capi-identity";
import { CONSENT_COOKIE, hasMarketingConsent } from "@/lib/cookie-consent";
import { getDict } from "@/lib/i18n/server";
import { sendCapiEvents } from "@/lib/meta-capi";
import { MEMBERSHIP_CURRENCY, MEMBERSHIP_VALUE } from "@/lib/meta-pixel-events";
import {
  captureServerEvent,
  toPosthogConsentMetadata,
} from "@/lib/posthog-server";
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

  // Snapshot the Meta CAPI identity (_fbp / _fbc / client IP / user-agent) at
  // the conversion moment so the context-less Stripe webhook can fire a
  // well-matched Purchase event. Gated on marketing consent — the capi_consent
  // sentinel inside this metadata is the signal the webhook reads to decide
  // whether CAPI may fire at all. No consent ⇒ no capi metadata ⇒ no Purchase
  // event. Like attribution, it is written on the subscription at creation and
  // never overwritten on renewal.
  const consentRaw = (await cookies()).get(CONSENT_COOKIE)?.value;
  const marketingOk = hasMarketingConsent(consentRaw);

  // Capture the Meta CAPI identity once — used both for the Purchase webhook
  // (round-tripped via capiMetadata) and for the InitiateCheckout event fired
  // below. Wrapped so a capture failure can't block checkout.
  let capiIdentity: CapiIdentity | null = null;
  let capiMetadata: Record<string, string> = {};
  if (marketingOk) {
    try {
      capiIdentity = await readCapiIdentity();
      capiMetadata = toCapiMetadata(capiIdentity);
    } catch (err) {
      console.warn("startCheckout: CAPI identity capture failed", { err });
    }
  }

  // First-party-analytics consent sentinel — written from the marketing-consent
  // flag alone (NOT derived from the CAPI identity above), so the webhook's
  // PostHog subscribe_succeeded fires independently of the Meta capi_consent
  // gate. See lib/posthog-server.ts.
  const analyticsMetadata = marketingOk ? toPosthogConsentMetadata() : {};

  // Locale drives both the Stripe-hosted page language and the
  // language of the withdrawal-waiver acceptance text below.
  const { locale, t } = await getDict();

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: {
          userId,
          ...attributionMetadata,
          ...capiMetadata,
          ...analyticsMetadata,
        },
      },
      // Stripe Tax — collect billing address, compute VAT/sales tax, and
      // persist the address back to the Customer so renewals invoice
      // correctly. Without this, EU/UK customers were billed at the flat
      // price with zero VAT, leaving the company on the hook.
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      billing_address_collection: "required",
      // EU 14-day right-of-withdrawal waiver (Terms §6). The required
      // ToS checkbox links to the URL set in the Stripe account's Public
      // Details (https://matio.tv/terms); custom_text replaces Stripe's
      // default acceptance line with the digital-content waiver so the
      // customer expressly consents to immediate supply. Stripe records
      // the acceptance on the session.
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message: t.subscribe.withdrawalWaiver,
        },
      },
      locale,
    },
    { idempotencyKey },
  );

  if (!session.url) throw new Error("Stripe did not return a session URL");

  // Fire the checkout-intent signals SERVER-SIDE, before the redirect to
  // Stripe. The browser previously fired these in the submit button's onClick,
  // but the immediate cross-origin navigation raced (and usually dropped) the
  // in-flight beacons — checkout_started never reached PostHog. Here we await
  // delivery (both clients are 3s-bounded and degrade to a no-op when
  // unconfigured) so the events actually land before we navigate away. Gated on
  // marketing consent. Meta dedups InitiateCheckout on event_id=session.id if
  // Stripe idempotency replays the same session. Both are best-effort: a
  // failure is logged but never blocks the redirect to checkout.
  if (marketingOk) {
    await Promise.all([
      sendCapiEvents([
        {
          eventName: "InitiateCheckout",
          eventId: session.id,
          actionSource: "website",
          eventSourceUrl: `${origin}/subscribe`,
          user: {
            email: user.email,
            externalId: userId,
            fbp: capiIdentity?.fbp,
            fbc: capiIdentity?.fbc,
            clientIpAddress: capiIdentity?.ip,
            clientUserAgent: capiIdentity?.ua,
          },
          customData: {
            value: MEMBERSHIP_VALUE,
            currency: MEMBERSHIP_CURRENCY,
            content_type: "product",
            content_ids: ["matio-membership"],
          },
        },
      ]).catch((err) => {
        console.warn("startCheckout: CAPI InitiateCheckout threw", { err });
      }),
      captureServerEvent({
        distinctId: userId,
        event: "checkout_started",
        properties: {
          value: MEMBERSHIP_VALUE,
          currency: MEMBERSHIP_CURRENCY,
        },
      }).catch((err) => {
        console.warn("startCheckout: PostHog checkout_started threw", { err });
      }),
    ]);
  }

  redirect(session.url);
}
