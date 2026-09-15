"use server";

import crypto from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { subscriptions, trialSessions } from "@/db/schema";
import { checkoutOrigin } from "@/lib/checkout-origin";
import { readAttributionCookies, toStripeMetadata } from "@/lib/attribution";
import {
  type CapiIdentity,
  readCapiIdentity,
  toCapiMetadata,
} from "@/lib/capi-identity";
import {
  type CheckoutSessionResult,
  type CheckoutTargetInput,
  embeddedCheckoutEnabled,
  expireIfOpen,
} from "@/lib/checkout-session";
import { buildWatchPath, resolveCheckoutTarget } from "@/lib/checkout-target";
import { CONSENT_COOKIE, hasMarketingConsent } from "@/lib/cookie-consent";
import { paymentsEnabled } from "@/lib/free-mode";
import { isInAppBrowser } from "@/lib/in-app-browser";
import {
  CHECKOUT_CLAIM_COOKIE,
  GUEST_METADATA_KEYS,
} from "@/lib/guest-checkout";
import {
  claimSoleGuestSession,
  hashClaimToken,
} from "@/lib/guest-checkout-sessions";
import { getDict } from "@/lib/i18n/server";
import { describeError } from "@/lib/observability";
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
import { guestCheckoutRateLimited } from "@/lib/checkout-rate-limit";
import { getStripe } from "@/lib/stripe";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";
import { getClientIp, hashClientIp, TRIAL_COOKIE } from "@/lib/trial";

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

// Pay-first guest checkout. Returns a CheckoutSessionResult the in-site
// /checkout page consumes (embedded client secret / hosted URL / redirect
// bounce); no longer redirects itself or takes FormData. Dispatched to from
// app/checkout/actions.ts only when there's no Clerk session.
export async function createGuestCheckoutSession(
  input: CheckoutTargetInput,
): Promise<CheckoutSessionResult> {
  // Payments off → nothing may create a Stripe session. First statement on
  // purpose: this is an independently POST-invocable "use server" action,
  // so the /checkout page + dispatcher guards aren't enough, and bailing
  // here also skips the DB reads / cookie write below. Straight home ("/"),
  // not subscribeFallback — /subscribe would just bounce home anyway.
  if (!paymentsEnabled()) return { kind: "redirect", to: "/" };

  const target = await resolveCheckoutTarget(input);
  const fallbackParams = new URLSearchParams();
  if (target.showSlug) fallbackParams.set("show", target.showSlug);
  if (target.episodeId) fallbackParams.set("ep", target.episodeId);
  if (target.resume) fallbackParams.set("resume", target.resume);
  const fallbackQs = fallbackParams.toString();
  const subscribeFallback = `/subscribe${fallbackQs ? `?${fallbackQs}` : ""}`;

  // Flag off → the auth flow takes over (proxy routes anonymous visitors
  // to Clerk sign-up). Also catches a stale navigation after a rollback.
  if (process.env.PAY_FIRST_CHECKOUT !== "1") {
    return { kind: "redirect", to: subscribeFallback };
  }

  // A live Clerk session means the signed-in flow must own this checkout:
  // it reuses the existing Stripe customer and runs the userId-keyed
  // duplicate-subscription guards. The dispatcher only routes here when
  // signed-out, so this is belt-and-braces.
  const { userId } = await auth();
  if (userId) return { kind: "redirect", to: subscribeFallback };

  // Rate-limit this UNAUTHENTICATED action per IP/hour BEFORE any expensive or
  // pollution-prone work (the trial-dup DB read, the live Stripe session, and
  // the Meta CAPI / PostHog events). A cookieless script otherwise gets a fresh
  // Stripe session + funnel events on every call. Same HMAC IP bucket as the
  // trial limiter. Over the limit → degrade into the auth flow (Clerk sign-up
  // naturally throttles), never reaching Stripe/analytics. Fail-open on a DB
  // error so an infra blip can't block real buyers.
  const reqHeaders = await headers();
  const ipHash = hashClientIp(getClientIp({ headers: reqHeaders }));
  // In-app browsers (FB/IG webviews) make the Embedded Checkout iframe +
  // Apple/Google Pay flaky and routinely drop the checkout_claim cookie across
  // the Stripe round-trip — fall back to the HOSTED Stripe page for them (more
  // robust, better wallet support).
  const inApp = isInAppBrowser(reqHeaders.get("user-agent"));
  if (await guestCheckoutRateLimited(ipHash)) {
    return { kind: "redirect", to: subscribeFallback };
  }

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
    if (linked) return { kind: "redirect", to: subscribeFallback };
  }

  // Claim token: binds this browser to the Checkout session. Reused from
  // the cookie when present so every tab of this browser is ONE buying
  // party — it is the key the sweep below remembers the previous session
  // under (a guest has no Stripe customer to list sessions by). httpOnly: the
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
  const stripe = getStripe();
  // Refuses on a deployment with no usable origin instead of charging the
  // card and returning the buyer to localhost (#202).
  const origin = checkoutOrigin();

  // After payment, Stripe sends the top frame to /welcome, which verifies the
  // session + the claim cookie and signs the buyer in. Used as return_url in
  // embedded mode and success_url in the hosted fallback — same string either
  // way. {CHECKOUT_SESSION_ID} is Stripe's literal template token (it must NOT
  // be URL-encoded), substituted identically for return_url and success_url.
  const successQs = fallbackQs ? `&${fallbackQs}` : "";
  const successUrl = `${origin}/welcome?session_id={CHECKOUT_SESSION_ID}${successQs}`;
  // Cancel (hosted fallback only) goes back to the player (the wall re-renders
  // there), NOT to /subscribe — an anonymous visitor would just bounce off
  // Clerk sign-up. The embedded form has no cancel button (back from /checkout).
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

  // Embedded (in-site iframe) when a publishable key is configured, else the
  // hosted-redirect fallback.
  const embedded = embeddedCheckoutEnabled() && !inApp;
  // NB: pinned Stripe API (2026-04-22.dahlia) names the value 'embedded_page'.
  const urlParams = embedded
    ? { ui_mode: "embedded_page" as const, return_url: successUrl }
    : { success_url: successUrl, cancel_url: cancelUrl };

  // No idempotency key, for the same reason the signed-in flow dropped its
  // own (#217, ADR 0002): a key that folds drifting request snapshots (the
  // resume playhead, capi_ip, attribution_last, the consent cookie) into a
  // digest is not "one session per buyer" — every drift is a second key and
  // a second live, billable session — and next to a sweep it is actively
  // harmful, because Stripe replays the CACHED first response for a key,
  // `status: 'open'` included, long after a newer session's sweep has expired
  // it. The invariant is enforced by the sweep right below instead; the brake
  // on session creation is guestCheckoutRateLimited above.
  const session = await stripe.checkout.sessions.create(
    buildCheckoutSessionParams({
      priceId,
      urlParams,
      subscriptionMetadata: sessionMetadata,
      locale,
      withdrawalWaiver: t.subscribe.withdrawalWaiver,
      clientReferenceId: claimToken,
    }),
  );

  // Not more than one open session per buying party (#224) — the guest half
  // of createSoleOpenSession. Create-then-sweep, so two same-instant creates
  // cannot both believe they were first; fail closed, so a client secret is
  // handed out only once the previous session is provably not payable.
  await expirePreviousGuestSession(stripe, claimToken, session.id);

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
            value: MEMBERSHIP_VALUE,
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
              value: MEMBERSHIP_VALUE,
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

  if (embedded) {
    if (!session.client_secret) {
      throw new Error("Stripe did not return an embedded client secret");
    }
    return {
      kind: "embedded",
      clientSecret: session.client_secret,
      sessionId: session.id,
    };
  }
  if (!session.url) throw new Error("Stripe did not return a session URL");
  return { kind: "hosted", url: session.url };
}

// The guest sweep (#224, ADR 0002). A signed-in buyer's other open sessions
// are found at Stripe by customer; a guest has no customer before payment and
// Stripe's list cannot filter by `client_reference_id`, so the previous session
// is remembered on our side under an HMAC of the claim cookie
// (guest_checkout_sessions) and expired BY ID: claimSoleGuestSession swaps the
// new id in and hands the old one back in one statement, so of two parallel
// tabs the later claim always sees the earlier tab's session and closes it.
//
// Fail closed, like createSoleOpenSession: if the id cannot be recorded (a DB
// error here is NOT the rate limiter's fail-open — an unrecorded session is
// one the NEXT creation can never find and expire, i.e. two live sessions) or
// the previous session cannot be proven closed, the new session is expired
// (best effort) and the error propagates. Logged by session ids and error
// class only — never the claim token, never the buyer.
//
// The claim runs BEFORE the expire (it is what tells us which id to expire),
// so by the time an expire fails the table already names the NEW session. If
// the previous one is then left open — Stripe 429/5xx, `retrieve` still says
// `open` — that open session would be on record nowhere: the next checkout
// would be handed the id of the session closed below, find nothing to expire,
// and the buyer would hold two live sessions again (the #224 defect, one
// step later). So on that path the claim is ROLLED BACK — `previous` is
// written back with the same upsert — before the error leaves; the next
// checkout then tries the same session again. If the rollback displaces a
// third tab's id (it claimed in the meantime), that tab's session stays live
// and unrecorded: logged by ids, accepted as a residual (ADR 0002, registry).
async function expirePreviousGuestSession(
  stripe: ReturnType<typeof getStripe>,
  claimToken: string,
  newSessionId: string,
): Promise<void> {
  const claimTokenHash = hashClaimToken(claimToken);
  let previous: string | null = null;
  // Set once the claim has returned: from here on a failure means the table
  // names the new session while `previous` may still be open.
  let claimed = false;
  try {
    previous = await claimSoleGuestSession(db, claimTokenHash, newSessionId);
    claimed = true;
    if (previous && previous !== newSessionId) {
      await expireIfOpen(stripe, previous);
    }
  } catch (err) {
    console.error(
      "startGuestCheckout: could not expire the buyer's previous open session — closing the new one",
      {
        sessionId: newSessionId,
        previousSessionId: previous,
        error: describeError(err),
      },
    );
    if (claimed && previous && previous !== newSessionId) {
      await rollBackGuestClaim(claimTokenHash, previous, newSessionId);
    }
    await stripe.checkout.sessions.expire(newSessionId).catch((closeErr) => {
      console.error("startGuestCheckout: closing the new session failed too", {
        sessionId: newSessionId,
        error: describeError(closeErr),
      });
    });
    throw err;
  }
}

// Puts `previous` back on record after its expire failed (see above). Only
// reached when expireIfOpen threw, i.e. the session is still open or its
// state could not be read — never when Stripe reported it closed (nothing to
// keep on record then). Best effort: the error is already on its way out.
async function rollBackGuestClaim(
  claimTokenHash: string,
  previous: string,
  newSessionId: string,
): Promise<void> {
  try {
    const displaced = await claimSoleGuestSession(db, claimTokenHash, previous);
    if (displaced !== newSessionId) {
      // A third tab claimed between our claim and this rollback: its session
      // is live and now off the record. Third-order residual — logged, not
      // handled (ADR 0002 "Accepted residuals", registry).
      console.error(
        "startGuestCheckout: rolling back the claim displaced a newer session — it stays open and unrecorded",
        { previousSessionId: previous, displacedSessionId: displaced, sessionId: newSessionId },
      );
    }
  } catch (rollbackErr) {
    // The table still names the session being closed; the previous one stays
    // open and unrecorded until it expires on its own (≤24h) — a double
    // fault (Stripe AND the database), logged so it can be seen.
    console.error("startGuestCheckout: rolling back the claim failed — the previous session stays unrecorded", {
      previousSessionId: previous,
      sessionId: newSessionId,
      error: describeError(rollbackErr),
    });
  }
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
