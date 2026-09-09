"use server";

import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { checkoutOrigin } from "@/lib/checkout-origin";
import { getOrSyncCurrentUser } from "@/lib/admin";
import {
  type CheckoutSessionResult,
  type CheckoutTargetInput,
  type WalletCheckoutResult,
  embeddedCheckoutEnabled,
} from "@/lib/checkout-session";
import {
  resolveWalletGate,
  toWaiverMetadata,
  walletCheckoutEnabled,
} from "@/lib/wallet-checkout";
import { auth } from "@clerk/nextjs/server";
import { buildWatchPath, resolveCheckoutTarget } from "@/lib/checkout-target";
import {
  buildCheckoutReturnUrl,
  parseCheckoutSessionParam,
  withCheckoutSessionId,
} from "@/lib/checkout-return";
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
import { paymentsEnabled } from "@/lib/free-mode";
import { isInAppBrowser } from "@/lib/in-app-browser";
import { getDict } from "@/lib/i18n/server";
import { buildCheckoutSessionParams } from "@/lib/checkout-session-params";
import { sendCapiEvents } from "@/lib/meta-capi";
import {
  MEMBERSHIP_CURRENCY,
  MEMBERSHIP_VALUE,
} from "@/lib/meta-pixel-events";
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

// Everything a signed-in checkout needs before it decides WHICH surface it is
// creating a session for: the auth resolution, both duplicate guards, the
// Stripe customer (created + written back if missing), the validated watch
// target, and the attribution / CAPI / analytics-consent snapshots.
//
// Extracted so the /checkout form (createAuthCheckoutSession) and the paywall's
// wallet button (createAuthWalletCheckoutSession, #210) run the SAME guards in
// the SAME order rather than growing a second, drifting copy. The guards are
// the reason this is worth a refactor: skipping the userId-keyed DB check or
// the Stripe source-of-truth check is how a subscriber gets charged twice.
type PreparedAuthCheckout = {
  userId: string;
  email: string;
  customerId: string;
  priceId: string;
  stripe: ReturnType<typeof getStripe>;
  origin: string;
  target: Awaited<ReturnType<typeof resolveCheckoutTarget>>;
  attribution: Awaited<ReturnType<typeof readAttributionCookies>>;
  capiIdentity: CapiIdentity | null;
  subscriptionMetadata: Record<string, string>;
  marketingOk: boolean;
  locale: Awaited<ReturnType<typeof getDict>>["locale"];
  t: Awaited<ReturnType<typeof getDict>>["t"];
};

async function prepareAuthCheckout(
  input: CheckoutTargetInput,
): Promise<
  | { kind: "redirect"; to: string }
  | ({ kind: "ready" } & PreparedAuthCheckout)
> {
  // Payments off → nothing may create a Stripe session. First statement on
  // purpose: an independently POST-invocable "use server" action, so the
  // /checkout page + dispatcher guards aren't enough on their own.
  if (!paymentsEnabled()) return { kind: "redirect", to: "/" };

  // getOrSyncCurrentUser handles the race where Clerk's user.created webhook
  // hasn't landed before a brand-new signup hits Subscribe. If we still come
  // back empty here something is wrong with auth — bounce to home, proxy
  // will redirect to sign-in on the next request.
  const user = await getOrSyncCurrentUser();
  if (!user) return { kind: "redirect", to: "/" };
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
  if (existing) return { kind: "redirect", to: "/" };

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
    return { kind: "redirect", to: "/" };
  }

  // Refuses on a deployment with no usable origin instead of charging the
  // card and returning the buyer to localhost (#202).
  const origin = checkoutOrigin();

  // If the user came from a watch flow, carry show+resume through so we
  // can drop them back into playback after checkout. Validation lives in
  // lib/checkout-target.ts (shared with the guest checkout).
  const target = await resolveCheckoutTarget(input);

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

  // Locale drives both the Stripe page language and the language of the
  // withdrawal-waiver acceptance text below.
  const { locale, t } = await getDict();

  // Subscription metadata (userId + attribution / CAPI / analytics-consent
  // snapshots). The ONLY channel to the cookie-less Stripe webhook, so both
  // surfaces carry it verbatim.
  const subscriptionMetadata = {
    userId,
    ...attributionMetadata,
    ...capiMetadata,
    ...analyticsMetadata,
  };

  return {
    kind: "ready",
    userId,
    email: user.email,
    customerId,
    priceId,
    stripe,
    origin,
    target,
    attribution,
    capiIdentity,
    subscriptionMetadata,
    marketingOk,
    locale,
    t,
  };
}

// Fires the checkout-intent signals (Meta InitiateCheckout + PostHog
// checkout_started). Kept as one function so the two surfaces cannot drift in
// what they report or when. Both clients are 3s-bounded and no-op when
// unconfigured; failures are logged, never thrown — an analytics outage must
// not block a payment. Meta dedups on event_id = session.id.
async function fireCheckoutIntent({
  sessionId,
  origin,
  userId,
  email,
  capiIdentity,
  attribution,
}: {
  sessionId: string;
  origin: string;
  userId: string;
  email: string;
  capiIdentity: CapiIdentity | null;
  attribution: Awaited<ReturnType<typeof readAttributionCookies>>;
}): Promise<void> {
  await Promise.all([
    sendCapiEvents([
      {
        eventName: "InitiateCheckout",
        eventId: sessionId,
        actionSource: "website",
        eventSourceUrl: `${origin}/subscribe`,
        user: {
          email,
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
        // First-touch UTM so the conversion funnel can break down by campaign
        // (already normalized + source-aliased by attribution.ts).
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
      console.warn("startCheckout: PostHog checkout_started threw", { err });
    }),
  ]);
}

// Signed-in checkout. Returns a CheckoutSessionResult the in-site /checkout
// page consumes: an embedded client secret (mount the Stripe iframe in-page), a
// hosted URL (publishable key unset — full-navigate to Stripe, legacy
// behavior), or a redirect (guard bounce). No longer redirects itself — the
// client owns navigation — and no longer takes FormData (called programmatically
// from the /checkout client). Dispatched to from app/checkout/actions.ts.
export async function createAuthCheckoutSession(
  input: CheckoutTargetInput,
): Promise<CheckoutSessionResult> {
  const prepared = await prepareAuthCheckout(input);
  if (prepared.kind === "redirect") return prepared;
  const {
    userId,
    email,
    customerId,
    priceId,
    stripe,
    origin,
    target,
    attribution,
    capiIdentity,
    subscriptionMetadata,
    marketingOk,
    locale,
    t,
  } = prepared;

  // No /account page anymore — checkout success lands back on the catalog.
  // If the user came from a watch flow, the watch path sends them straight
  // back into playback. In embedded mode this is the return_url Stripe sends
  // the top frame to after payment; in hosted mode it's success_url. Either
  // way it's our own domain — the subscription is mirrored by the webhook.
  const watchPath = buildWatchPath(target);
  // `cs={CHECKOUT_SESSION_ID}` is substituted by Stripe on return — the
  // watch page / home read it to fire the browser-side purchase beacon once
  // (components/site/purchase-pixel.tsx). Same placeholder the guest flow
  // already uses for /welcome; it is a public-ish id that grants nothing.
  const successUrl = buildCheckoutReturnUrl(origin, watchPath);
  // Cancel only applies to the hosted fallback (the embedded form has no
  // cancel button — the buyer navigates back from /checkout itself).
  const cancelParams = new URLSearchParams();
  if (target.showSlug) cancelParams.set("show", target.showSlug);
  if (target.episodeId) cancelParams.set("ep", target.episodeId);
  if (target.resume) cancelParams.set("resume", target.resume);
  const cancelQs = cancelParams.toString();
  const cancelUrl = `${origin}/subscribe${cancelQs ? `?${cancelQs}` : ""}`;

  // Embedded (in-site iframe) when a publishable key is configured, else the
  // hosted-redirect fallback. Embedded uses return_url and rejects
  // success_url/cancel_url; hosted uses success_url/cancel_url — so the two are
  // mutually exclusive, spread in per mode. NB: the pinned Stripe API
  // (2026-04-22.dahlia) names the value 'embedded_page', not 'embedded'.
  // In-app browsers (FB/IG webviews) get the HOSTED page — the embedded iframe
  // + Apple/Google Pay are flaky there (same reason as the guest flow). Folded
  // into the idempotency variant below so a webview's hosted session can't
  // collide a same-user embedded one within the hour.
  const inApp = isInAppBrowser((await headers()).get("user-agent"));
  const embedded = embeddedCheckoutEnabled() && !inApp;
  const urlParams = embedded
    ? { ui_mode: "embedded_page" as const, return_url: successUrl }
    : { success_url: successUrl, cancel_url: cancelUrl };

  // Idempotency key dedupes parallel-tab clicks (same intent within the hour →
  // same Stripe session). The variant digest folds in every create param that
  // can drift — the success/return URL, the metadata, locale, the embedded
  // flag, and the SURFACE — so a changed-intent retry within the hour (a
  // different show/resume, a locale switch, the hosted→embedded transition, or
  // a buyer who dismissed the paywall's wallet sheet and then walked to
  // /checkout) gets a NEW key instead of Stripe 400ing `idempotency_error`
  // ("same key, different parameters"). Mirrors the guest flow's key in
  // guest-actions.ts.
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  const variant = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        successUrl,
        cancelUrl,
        subscriptionMetadata,
        locale,
        embedded,
        surface: "embedded",
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const idempotencyKey = `checkout:${userId}:${hourBucket}:${variant}`;

  const session = await stripe.checkout.sessions.create(
    {
      ...buildCheckoutSessionParams({
        priceId,
        urlParams,
        subscriptionMetadata: subscriptionMetadata,
        locale,
        withdrawalWaiver: t.subscribe.withdrawalWaiver,
        customerId,
      }),
    },
    { idempotencyKey },
  );

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
    await fireCheckoutIntent({
      sessionId: session.id,
      origin,
      userId,
      email,
      capiIdentity,
      attribution,
    });
  }

  if (embedded) {
    if (!session.client_secret) {
      throw new Error("Stripe did not return an embedded client secret");
    }
    return { kind: "embedded", clientSecret: session.client_secret };
  }
  if (!session.url) throw new Error("Stripe did not return a session URL");
  return { kind: "hosted", url: session.url };
}

// ---------------------------------------------------------------------------
// The paywall's in-place wallet button (Apple Pay / Google Pay) — issue #210.
// ---------------------------------------------------------------------------
// Creates a `ui_mode: 'elements'` Checkout Session so the browser can mount a
// bare ExpressCheckoutElement inside the paywall overlay. Deliberately the SAME
// Checkout Session object as /checkout, built by the SAME
// buildCheckoutSessionParams: price, automatic_tax, billing_address_collection,
// customer_update, locale and the whole subscription_data.metadata channel are
// identical, so planFromPriceId still resolves, Stripe Tax still persists on the
// subscription, and the webhook mirror / attribution / CAPI / PostHog machinery
// downstream is untouched. Only the consent pair moves into our own UI, because
// Stripe will not render it here (see lib/checkout-session-params.ts).
//
// v1 is SIGNED-IN ONLY. An anonymous buyer gets `unavailable` and keeps today's
// card CTA: the guest path additionally mints a Clerk account and a sign-in
// ticket from a wallet-supplied email, which is the code the 2026-06-16 webview
// incident hardened, and it earns its own PR and its own rehearsal.
export async function createAuthWalletCheckoutSession(
  input: CheckoutTargetInput,
  waiverAccepted: boolean,
): Promise<WalletCheckoutResult> {
  // One table decides whether this surface may exist at all
  // (lib/wallet-checkout.ts). Evaluated FIRST and in full, before any Stripe
  // or DB work, for the same reason createAuthCheckoutSession guards on its
  // first statement: a "use server" action is independently POST-invocable, so
  // the paywall's own gating is never enough on its own.
  const { userId: authUserId } = await auth();
  const verdict = resolveWalletGate({
    paymentsOn: paymentsEnabled(),
    flagOn: walletCheckoutEnabled(),
    hasPublishableKey: embeddedCheckoutEnabled(),
    inAppBrowser: isInAppBrowser((await headers()).get("user-agent")),
    signedIn: Boolean(authUserId),
    waiverAccepted,
  });
  if (verdict === "payments_off") return { kind: "redirect", to: "/" };
  if (verdict !== "ok") return { kind: "unavailable" };

  const prepared = await prepareAuthCheckout(input);
  if (prepared.kind === "redirect") return prepared;
  const {
    userId,
    email,
    customerId,
    priceId,
    stripe,
    origin,
    target,
    attribution,
    capiIdentity,
    subscriptionMetadata,
    marketingOk,
    locale,
    t,
  } = prepared;

  // Same destination as the /checkout flow — the buyer lands back in playback,
  // where the existing cs= verification + inline idempotent mirror run.
  const successUrl = buildCheckoutReturnUrl(origin, buildWatchPath(target));

  // The acceptance record travels the metadata channel with everything else, so
  // the webhook sees it on the subscription. Not a new DB column on purpose —
  // see lib/wallet-checkout.ts.
  //
  // The acceptance is stamped from the START OF THE IDEMPOTENCY HOUR, not from
  // `new Date()`. A millisecond-precision timestamp here would be fatal to the
  // double-charge guard below: it rides in the metadata that the variant digest
  // hashes, so every call would mint a different key, Stripe's replay would
  // never trigger, and two tabs would create two live sessions — the exact
  // parallel-tap double-charge the key exists to collapse. Hashing the metadata
  // WITHOUT the timestamp does not work either: the create params would then
  // differ under an identical key, which Stripe rejects outright with
  // `idempotency_error`.
  //
  // Hour granularity is the honest trade and costs nothing evidentially: what
  // the waiver has to prove is that the buyer asked for immediate supply BEFORE
  // supply began, and the subscription's own creation timestamp — precise, and
  // necessarily later — supplies the other half.
  const hourBucket = Math.floor(Date.now() / (1000 * 60 * 60));
  const walletMetadata = {
    ...subscriptionMetadata,
    ...toWaiverMetadata(new Date(hourBucket * 60 * 60 * 1000)),
  };

  const variant = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        successUrl,
        subscriptionMetadata: walletMetadata,
        locale,
        surface: "elements",
      }),
    )
    .digest("hex")
    .slice(0, 16);

  const session = await stripe.checkout.sessions.create(
    buildCheckoutSessionParams({
      priceId,
      // return_url keeps Stripe's placeholder so REDIRECT-based confirmations
      // (3DS / SCA step-up) still get it substituted. The inline success path
      // has no redirect, so the client is handed the finished URL below.
      urlParams: { ui_mode: "elements" as const, return_url: successUrl },
      subscriptionMetadata: walletMetadata,
      locale,
      withdrawalWaiver: t.subscribe.withdrawalWaiver,
      customerId,
      surface: "elements",
    }),
    { idempotencyKey: `checkout:${userId}:${hourBucket}:${variant}` },
  );

  if (!session.client_secret) {
    throw new Error("Stripe did not return an elements client secret");
  }

  // checkout_started / InitiateCheckout are NOT fired here. Unlike /checkout —
  // which a buyer reaches by an intentful click — this session is created to
  // render a button, i.e. on every paywall IMPRESSION. Firing here would turn
  // checkout_started into a wall-impression counter and break the saved PostHog
  // funnel (trial_play_started → checkout_started → subscribe_succeeded). The
  // events fire from reportWalletCheckoutStarted below, at confirm time, keyed
  // on this same session id so Meta's dedup still works.
  void marketingOk;
  void email;
  void attribution;
  void capiIdentity;

  return {
    kind: "wallet",
    clientSecret: session.client_secret,
    sessionId: session.id,
    returnUrl: withCheckoutSessionId(successUrl, session.id),
  };
}

// Confirm-time twin of the intent signals the /checkout flow fires inside its
// builder. Called by the paywall the moment the buyer confirms the wallet
// sheet, so `checkout_started` keeps meaning "a buyer intended to pay" rather
// than "a wall was shown". Best-effort by construction: it returns void, never
// throws, and nothing about the payment depends on it.
export async function reportWalletCheckoutStarted(
  sessionId: string,
): Promise<void> {
  if (!paymentsEnabled() || !walletCheckoutEnabled()) return;
  // Shape-check the caller-supplied id before it becomes a Meta event id.
  if (!parseCheckoutSessionParam(sessionId)) return;

  const { userId } = await auth();
  if (!userId) return;

  const consentRaw = (await cookies()).get(CONSENT_COOKIE)?.value;
  if (!hasMarketingConsent(consentRaw)) return;

  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return;

  let capiIdentity: CapiIdentity | null = null;
  try {
    capiIdentity = await readCapiIdentity();
  } catch (err) {
    console.warn("walletCheckout: CAPI identity capture failed", { err });
  }

  try {
    await fireCheckoutIntent({
      sessionId,
      origin: checkoutOrigin(),
      userId,
      email: user.email,
      capiIdentity,
      attribution: await readAttributionCookies(),
    });
  } catch (err) {
    console.warn("walletCheckout: checkout-intent reporting threw", { err });
  }
}
