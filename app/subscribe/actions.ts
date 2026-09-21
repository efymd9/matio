"use server";

import type Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { checkoutOrigin } from "@/lib/checkout-origin";
import { getOrSyncCurrentUser } from "@/lib/admin";
import {
  AUTH_CHECKOUT_RATELIMIT_PER_HOUR,
  checkoutRateLimited,
} from "@/lib/checkout-rate-limit";
import {
  CheckoutRateLimitedError,
  type CheckoutSessionResult,
  type CheckoutTargetInput,
  type WalletCheckoutResult,
  embeddedCheckoutEnabled,
  expireIfOpen,
} from "@/lib/checkout-session";
import { hashClientIp } from "@/lib/trial";
import {
  resolveWalletGate,
  toConsentMetadata,
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
import { describeError } from "@/lib/observability";
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
  | { kind: "rate_limited" }
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

  // Per-account brake on session creation (#227) — right after the auth guard
  // and BEFORE anything that talks to Stripe (customers.create, the create +
  // sweep in createSoleOpenSession). Since #217 the create carries no
  // idempotency key, so without this every reload of /checkout and every
  // re-tick of the wallet box is a real Stripe create + list + N expire and,
  // with consent, a fresh InitiateCheckout / checkout_started. Counted on
  // EVERY call, like the guest brake, so a flood that ends in errors is braked
  // too. The bucket is `user:` + HMAC(userId) with the trial limiter's salt —
  // the table sees a hash, not the Clerk id (lib/checkout-rate-limit.ts).
  // Fail-open by construction: a DB blip must never block a real buyer.
  if (
    await checkoutRateLimited(
      `user:${hashClientIp(userId)}`,
      AUTH_CHECKOUT_RATELIMIT_PER_HOUR,
    )
  ) {
    console.warn("startCheckout: rate limited", { userId });
    return { kind: "rate_limited" };
  }

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
    // Deterministic idempotency key (#217, scenario 4). Two FIRST checkouts
    // racing in parallel tabs both land here — each read the users row before
    // the other wrote it back — and without a key Stripe minted two customers:
    // the write-back was "last writer wins", so one tab's session sat on a
    // customer the users row no longer named, the webhook found no user for
    // it and the cs= return refused the mismatch — money taken, no access.
    // With `customer:<userId>` Stripe replays the first customer to the second
    // caller, so both sessions and both write-backs converge on one id; that
    // is also what makes running this twice safe. (The same key with a changed
    // e-mail inside Stripe's 24h window is an `idempotency_error`; it takes a
    // failed write-back AND an address change in the same day, and it heals
    // itself when the key expires — accepted.)
    const customer = await stripe.customers.create(
      { email: user.email, metadata: { userId } },
      { idempotencyKey: `customer:${userId}` },
    );
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
      console.warn("startCheckout: CAPI identity capture failed", { error: describeError(err) });
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
      console.warn("startCheckout: CAPI InitiateCheckout threw", { error: describeError(err) });
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
      console.warn("startCheckout: PostHog checkout_started threw", { error: describeError(err) });
    }),
  ]);
}

// ---------------------------------------------------------------------------
// One open Checkout Session per customer — issue #217.
// ---------------------------------------------------------------------------
// Two live billable sessions for one buyer is a double charge waiting for a
// second tap, and the duplicate guards in prepareAuthCheckout only look at
// SUBSCRIPTIONS, i.e. they fire at creation, not at payment. The hour-bucketed
// idempotency key that used to stand in for this invariant only held while
// every create param stayed byte-identical between two calls, and the params
// are request snapshots: a consent banner accepted between two tabs, a resume
// playhead ten seconds further along, the wallet surface next to /checkout —
// each one was a different key, a second live session, a second $25.
//
// The invariant is enforced AFTER the create, against everything but the
// session just created, and it holds regardless of any key:
//   * create-then-sweep has no residual race: two creates that both list "the
//     others" AFTER their own create is committed cannot both see an empty
//     list — whichever list runs last sees the other session and expires it,
//     so once both calls return at most one session is open (Stripe's list
//     endpoint reads its primary store; only Search is eventually consistent).
//     A sweep-then-create would leave the same-instant pair both alive.
//   * a sweep that cannot be completed closes the session it was protecting
//     and throws: a client secret is handed out only once every other open
//     session of the customer is provably gone. Fail closed on the money path.
//
// Running it twice is safe by construction: the second run creates a session
// and expires the first one, so the customer still holds at most one that can
// take money. The client that lost its session sees the failure at confirm /
// on refocus and offers a retry (wallet-express-checkout.tsx, checkout-client.tsx).
//
// No idempotency key on the create, deliberately. Stripe replays the CACHED
// response of the first request for a key — including a `status: 'open'` that
// the sweep of a newer session has since falsified — so a stable key would hand
// a dead session to every retry for the rest of the hour, with no way to tell
// from the response. Dedupe of a same-intent double tap is the clients' job
// (both guard with a startedRef); at worst a burst creates N sessions of which
// N−1 are expired here. Logged by ids and error class only — never the buyer.
async function createSoleOpenSession(
  stripe: Stripe,
  customerId: string,
  params: Stripe.Checkout.SessionCreateParams,
): Promise<Stripe.Checkout.Session> {
  const session = await stripe.checkout.sessions.create(params);
  try {
    await expireOtherOpenSessions(stripe, customerId, session.id);
  } catch (err) {
    console.error(
      "startCheckout: could not expire the customer's other open sessions — closing the new one",
      { sessionId: session.id, customerId, error: describeError(err) },
    );
    await stripe.checkout.sessions.expire(session.id).catch((closeErr) => {
      console.error("startCheckout: closing the new session failed too", {
        sessionId: session.id,
        error: describeError(closeErr),
      });
    });
    throw err;
  }
  return session;
}

// How many list pages the sweep will work through before giving up. Each
// round expires up to 100 sessions, so this bounds a customer at 1,000 open
// sessions — a number nothing legitimate produces; past it the sweep fails
// closed like any other failure, rather than looping on a runaway account.
const SWEEP_MAX_ROUNDS = 10;

async function expireOtherOpenSessions(
  stripe: Stripe,
  customerId: string,
  keepId: string,
): Promise<void> {
  // Only sessions created WITH `customer` are listable this way — the guest
  // flow's sessions are not; that flow remembers its buyer's previous session
  // id itself and expires it by id (lib/guest-checkout-sessions.ts, #224).
  //
  // Paged by RE-LISTING, not by cursor: every session expired here leaves the
  // `status: 'open'` result set, so the next unfiltered first page surfaces
  // what was behind it. A `starting_after` cursor would point at an object
  // this very loop has just removed from the filtered list — Stripe does not
  // document what that yields, and the money path is no place to find out.
  for (let round = 0; round < SWEEP_MAX_ROUNDS; round++) {
    const page = await stripe.checkout.sessions.list({
      customer: customerId,
      status: "open",
      limit: 100,
    });
    for (const other of page.data) {
      if (other.id === keepId) continue;
      // Losing the race to whoever closed it first is fine; a session left
      // OPEN is not, and propagates (expireIfOpen, shared with the guest sweep).
      await expireIfOpen(stripe, other.id);
    }
    if (!page.has_more) return;
  }
  throw new Error(
    `checkout sweep: customer still has more open sessions after ${SWEEP_MAX_ROUNDS} pages`,
  );
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
  // Over the per-account budget (#227): the /checkout client turns a rejected
  // action into its existing retry card — the right words for "later", where
  // a redirect home would read as "you cannot buy".
  if (prepared.kind === "rate_limited") throw new CheckoutRateLimitedError();
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
  // (STRIPE_API_VERSION, lib/stripe.ts) names the value 'embedded_page', not
  // 'embedded' — and the SDK's UiMode type ends in an open `| OtherString`,
  // so tsc would NOT catch the old spelling; only the API would.
  // In-app browsers (FB/IG webviews) get the HOSTED page — the embedded iframe
  // + Apple/Google Pay are flaky there (same reason as the guest flow).
  const inApp = isInAppBrowser((await headers()).get("user-agent"));
  const embedded = embeddedCheckoutEnabled() && !inApp;
  const urlParams = embedded
    ? { ui_mode: "embedded_page" as const, return_url: successUrl }
    : { success_url: successUrl, cancel_url: cancelUrl };

  // No hour-bucketed idempotency key here any more — this create expires the
  // buyer's other open sessions instead, see createSoleOpenSession (#217).
  // The guest flow keeps its key (it has no customer to sweep by).
  const session = await createSoleOpenSession(
    stripe,
    customerId,
    buildCheckoutSessionParams({
      priceId,
      urlParams,
      subscriptionMetadata: subscriptionMetadata,
      locale,
      withdrawalWaiver: t.subscribe.withdrawalWaiver,
      customerId,
    }),
  );

  // Fire the checkout-intent signals SERVER-SIDE, before the redirect to
  // Stripe. The browser previously fired these in the submit button's onClick,
  // but the immediate cross-origin navigation raced (and usually dropped) the
  // in-flight beacons — checkout_started never reached PostHog. Here we await
  // delivery (both clients are 3s-bounded and degrade to a no-op when
  // unconfigured) so the events actually land before we navigate away. Gated on
  // marketing consent. Meta dedups InitiateCheckout on event_id=session.id.
  // Both are best-effort: a failure is logged but never blocks the redirect to
  // checkout.
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
    // The id lets the /checkout client ask whether this session is still open
    // when its tab comes back into view (checkoutSessionState, #217).
    return {
      kind: "embedded",
      clientSecret: session.client_secret,
      sessionId: session.id,
    };
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
  consentAccepted: boolean,
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
    consentAccepted,
  });
  if (verdict === "payments_off") return { kind: "redirect", to: "/" };
  if (verdict !== "ok") return { kind: "unavailable" };

  const prepared = await prepareAuthCheckout(input);
  if (prepared.kind === "redirect") return prepared;
  // Over the per-account budget (#227): the wallet slot simply does not
  // render — `unavailable` is the paywall's normal "keep the card CTA" state,
  // not an error, and the buyer still has /checkout.
  if (prepared.kind === "rate_limited") return { kind: "unavailable" };
  const {
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

  // The consent record travels the metadata channel with everything else, so
  // the webhook sees it on the subscription. Not a new DB column on purpose —
  // see lib/wallet-checkout.ts. It carries WHICH terms were accepted and no
  // time at all (#214): the exact moment is the session's own `created`, which
  // cannot precede the tick that caused it, and a second clock in the record
  // would be a second, contestable, answer to the same question.
  const walletMetadata = {
    ...subscriptionMetadata,
    ...toConsentMetadata(),
  };

  // Same one-open-session rule as /checkout (createSoleOpenSession, #217):
  // this create expires a /checkout session left open in another tab, and a
  // later /checkout expires this one — the two surfaces can no longer both be
  // paid. No idempotency key, for the reason given on the helper.
  const session = await createSoleOpenSession(
    stripe,
    customerId,
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
    console.warn("walletCheckout: CAPI identity capture failed", { error: describeError(err) });
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
    console.warn("walletCheckout: checkout-intent reporting threw", { error: describeError(err) });
  }
}
