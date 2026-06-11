"use server";

import crypto from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { subscriptions, trialSessions } from "@/db/schema";
import { readAttributionCookies, toStripeMetadata } from "@/lib/attribution";
import {
  type CapiIdentity,
  readCapiIdentity,
  toCapiMetadata,
} from "@/lib/capi-identity";
import { buildWatchPath, resolveCheckoutTarget } from "@/lib/checkout-target";
import {
  checkoutLineItems,
  TRIAL_FEE_VALUE,
  TRIAL_SUBSCRIPTION_DATA,
} from "@/lib/checkout-trial";
import { CONSENT_COOKIE, hasMarketingConsent } from "@/lib/cookie-consent";
import {
  CHECKOUT_CLAIM_COOKIE,
  GUEST_METADATA_KEYS,
} from "@/lib/guest-checkout";
import { getDict } from "@/lib/i18n/server";
import { sendCapiEvents } from "@/lib/meta-capi";
import { MEMBERSHIP_CURRENCY } from "@/lib/meta-pixel-events";
import {
  captureServerEvent,
  toPosthogConsentMetadata,
} from "@/lib/posthog-server";
import { getStripe } from "@/lib/stripe";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";
import { TRIAL_COOKIE } from "@/lib/trial";

// Pay-first ("invisible account") checkout entry point: NO auth — the
// anonymous paywall CTA posts here and goes straight to Stripe Checkout.
// Stripe collects the email; the account is created after payment by
// claimGuestCheckout (webhook / the /welcome success page). Flag-gated via
// PAY_FIRST_CHECKOUT so the whole flow can ship dark and degrade safely:
// with the flag off (or a stale signed-in session) we fall back to the
// existing /subscribe auth flow, which owns its own duplicate-purchase
// guards and Stripe customer reuse.

const CLAIM_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function startGuestCheckout(formData: FormData) {
  const target = await resolveCheckoutTarget(formData);
  const fallbackParams = new URLSearchParams();
  if (target.showSlug) fallbackParams.set("show", target.showSlug);
  if (target.episodeId) fallbackParams.set("ep", target.episodeId);
  if (target.resume) fallbackParams.set("resume", target.resume);
  const fallbackQs = fallbackParams.toString();
  const subscribeFallback = `/subscribe${fallbackQs ? `?${fallbackQs}` : ""}`;

  // Flag off → the auth flow takes over (proxy routes anonymous visitors
  // to Clerk sign-up). Also catches a stale form post after a rollback.
  if (process.env.PAY_FIRST_CHECKOUT !== "1") redirect(subscribeFallback);

  // A live Clerk session means the signed-in flow must own this checkout:
  // it reuses the existing Stripe customer and runs the userId-keyed
  // duplicate-subscription guards. The paywall only shows this CTA to
  // signed-out viewers, so this is belt-and-braces.
  const { userId } = await auth();
  if (userId) redirect(subscribeFallback);

  const store = await cookies();

  // Soft duplicate-purchase pre-flight: if this browser's trial cookie is
  // already linked to a user who holds an access-granting subscription,
  // this is almost certainly an existing subscriber who got signed out —
  // route them into the auth flow (sign-in → AlreadySubscribed) instead of
  // letting them buy the same membership twice. Probabilistic by nature
  // (cookies die in ad webviews); the hard guard lives in
  // lib/subscription-mirror.ts at claim time.
  const trialToken = store.get(TRIAL_COOKIE)?.value ?? null;
  if (trialToken) {
    const [linked] = await db
      .select({ id: subscriptions.id })
      .from(trialSessions)
      .innerJoin(
        subscriptions,
        eq(subscriptions.userId, trialSessions.userId),
      )
      .where(
        and(
          eq(trialSessions.sessionToken, trialToken),
          inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
        ),
      )
      .limit(1);
    if (linked) redirect(subscribeFallback);
  }

  // Claim token: binds this browser to the Checkout session. Reused from
  // the cookie when present so parallel-tab submits share one token (and
  // therefore one Stripe idempotency key → one session). httpOnly: the
  // /welcome page compares it server-side against the session's
  // client_reference_id before minting a sign-in ticket; client JS must
  // never be able to read or fake it.
  const existingClaim = store.get(CHECKOUT_CLAIM_COOKIE)?.value;
  const claimToken =
    existingClaim && UUID_RE.test(existingClaim)
      ? existingClaim
      : crypto.randomUUID();
  store.set(CHECKOUT_CLAIM_COOKIE, claimToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CLAIM_COOKIE_MAX_AGE,
  });

  const priceId = process.env.STRIPE_PRICE_MONTHLY;
  if (!priceId) {
    throw new Error("Stripe price for monthly not configured");
  }
  // $1/3-day intro trial is mandatory once live — fail loud rather than
  // silently charge $38 today against the "$1 for 3 days" copy.
  const trialFeePriceId = process.env.STRIPE_PRICE_TRIAL_FEE;
  if (!trialFeePriceId) {
    throw new Error("Stripe trial fee price not configured");
  }
  const stripe = getStripe();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Success lands on /welcome, which verifies payment + the claim cookie
  // and signs the buyer in. {CHECKOUT_SESSION_ID} is Stripe's literal
  // template token — it must NOT be URL-encoded.
  const successQs = fallbackQs ? `&${fallbackQs}` : "";
  const successUrl = `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}${successQs}`;
  // Cancel goes back to the player (the wall re-renders there), NOT to
  // /subscribe — an anonymous visitor would just bounce off Clerk sign-up.
  const watchPath = buildWatchPath(target);
  const cancelUrl = watchPath ? `${origin}${watchPath}` : `${origin}/`;

  // Same attribution / CAPI-identity / PostHog-consent metadata channel as
  // the signed-in flow — the webhook reads it back identically. Plus the
  // guest markers: guest flag, claim token, and the trial cookie for
  // exact-token trial→paid linkage at claim time.
  const attribution = await readAttributionCookies();
  const attributionMetadata = toStripeMetadata(
    attribution.first,
    attribution.last,
  );

  const consentRaw = store.get(CONSENT_COOKIE)?.value;
  const marketingOk = hasMarketingConsent(consentRaw);

  let capiIdentity: CapiIdentity | null = null;
  let capiMetadata: Record<string, string> = {};
  if (marketingOk) {
    try {
      capiIdentity = await readCapiIdentity();
      capiMetadata = toCapiMetadata(capiIdentity);
    } catch (err) {
      console.warn("startGuestCheckout: CAPI identity capture failed", { err });
    }
  }
  const analyticsMetadata = marketingOk ? toPosthogConsentMetadata() : {};

  const guestMetadata: Record<string, string> = {
    [GUEST_METADATA_KEYS.guest]: "1",
    [GUEST_METADATA_KEYS.claimToken]: claimToken,
    // Stripe caps metadata values at 500 chars; the trial token is a UUID
    // but guard against a tampered oversized cookie anyway.
    ...(trialToken && trialToken.length <= 200
      ? { [GUEST_METADATA_KEYS.trialToken]: trialToken }
      : {}),
  };

  // Locale drives both the Stripe-hosted page language and the
  // language of the withdrawal-waiver acceptance text below.
  const { locale, t } = await getDict();

  const sessionMetadata = {
    ...guestMetadata,
    ...attributionMetadata,
    ...capiMetadata,
    ...analyticsMetadata,
  };

  // One session per (claim token, hour, request-variant): parallel-tab
  // submits with identical params replay the same Checkout session, but a
  // changed-intent retry within the hour (a new resume playhead, a
  // different show/ep on cancel-and-retry, a rotated mobile IP in capi_ip,
  // a fresh attribution_last, a locale switch) MUST get a new session —
  // Stripe 400s `idempotency_error` when the same key is replayed with
  // different params, which would otherwise dead-end the only anonymous
  // purchase path until the hour rolls. The variant digest folds the
  // drifting parts into the key so only true duplicates collide.
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  const variant = crypto
    .createHash("sha256")
    .update(JSON.stringify({ successUrl, cancelUrl, sessionMetadata, locale }))
    .digest("hex")
    .slice(0, 16);
  const idempotencyKey = `checkout:guest:${claimToken}:${hourBucket}:${variant}`;

  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      // Deliberately NO `customer` (none exists yet — Stripe creates one
      // from the email typed on the hosted page) and NO `customer_update`
      // (Stripe rejects it without an existing customer; the collected
      // billing address lands on the new customer automatically).
      client_reference_id: claimToken,
      line_items: checkoutLineItems(priceId, trialFeePriceId),
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        // $1 today, 3-day trial, then $38/mo (see lib/checkout-trial.ts).
        ...TRIAL_SUBSCRIPTION_DATA,
        metadata: sessionMetadata,
      },
      // Stripe Tax + EU withdrawal waiver: identical to the signed-in flow
      // (see app/subscribe/actions.ts for the rationale on each).
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
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

  // Checkout-intent signals, server-side before the redirect (browser
  // beacons race the cross-origin navigation — see startCheckout). No
  // email/externalId yet: Meta matches on fbp/fbc/IP/UA; PostHog uses the
  // browser's device distinct_id (parsed from the posthog-js cookie) so the
  // anonymous funnel stitches once the buyer signs in and identifies.
  if (marketingOk) {
    // Only fire checkout_started when we have the real device distinct_id.
    // A synthetic guest:<token> id would create an orphan PostHog person
    // that never merges into the buyer (no upstream events share it), which
    // shows up as a phantom drop-off at the checkout step — noise, not
    // signal. No cookie ⇒ the device's earlier funnel events don't exist
    // either, so skipping loses nothing.
    const phDistinctId = await readPosthogDistinctId();
    await Promise.all([
      sendCapiEvents([
        {
          eventName: "InitiateCheckout",
          eventId: session.id,
          actionSource: "website",
          eventSourceUrl: watchPath ? `${origin}${watchPath}` : origin,
          user: {
            fbp: capiIdentity?.fbp,
            fbc: capiIdentity?.fbc,
            clientIpAddress: capiIdentity?.ip,
            clientUserAgent: capiIdentity?.ua,
          },
          customData: {
            value: TRIAL_FEE_VALUE,
            currency: MEMBERSHIP_CURRENCY,
            content_type: "product",
            content_ids: ["matio-membership"],
          },
        },
      ]).catch((err) => {
        console.warn("startGuestCheckout: CAPI InitiateCheckout threw", {
          err,
        });
      }),
      phDistinctId
        ? captureServerEvent({
            distinctId: phDistinctId,
            event: "checkout_started",
            properties: {
              value: TRIAL_FEE_VALUE,
              currency: MEMBERSHIP_CURRENCY,
              flow: "pay_first",
              ...(attribution.first.source
                ? { utm_source: attribution.first.source }
                : {}),
              ...(attribution.first.medium
                ? { utm_medium: attribution.first.medium }
                : {}),
              ...(attribution.first.campaign
                ? { utm_campaign: attribution.first.campaign }
                : {}),
            },
          }).catch((err) => {
            console.warn("startGuestCheckout: PostHog checkout_started threw", {
              err,
            });
          })
        : Promise.resolve(),
    ]);
  }

  redirect(session.url);
}

// posthog-js persists {distinct_id} in a `ph_<key>_posthog` cookie. Reading
// it server-side lets the anonymous checkout_started land on the SAME
// person posthog-js has been building on this device, so the funnel
// stitches once sign-in identify()s. Best-effort: any parse failure means
// the caller falls back to a claim-token-scoped id.
async function readPosthogDistinctId(): Promise<string | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  try {
    const raw = (await cookies()).get(`ph_${key}_posthog`)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { distinct_id?: unknown };
    return typeof parsed.distinct_id === "string" && parsed.distinct_id
      ? parsed.distinct_id
      : null;
  } catch {
    return null;
  }
}
