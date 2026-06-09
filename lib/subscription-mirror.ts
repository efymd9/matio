import "server-only";
import crypto from "node:crypto";
import type Stripe from "stripe";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import {
  fromStripeMetadata,
  toFirstColumns,
  toLastColumns,
} from "@/lib/attribution";
import { fromCapiMetadata, metadataHasCapiConsent } from "@/lib/capi-identity";
import { claimGuestCheckout, isGuestSubscription } from "@/lib/guest-checkout";
import { sendCapiEvents } from "@/lib/meta-capi";
import {
  captureServerEvent,
  metadataHasPosthogConsent,
} from "@/lib/posthog-server";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";
import { markUserTrialsConverted } from "@/lib/trial";

// mirrorSubscription used to live inside app/api/webhooks/stripe/route.ts.
// It moved here (unchanged in behavior for non-guest subscriptions) so the
// /welcome success page can run the SAME idempotent mirror inline and close
// the webhook-vs-redirect race for guest (pay-first) checkouts without
// polling — whichever writer commits first wins; the other's upsert is a
// no-op keyed on stripe_subscription_id. The data source is always a
// server-side Stripe retrieve/webhook payload, never client state, so the
// "all payment state flows through Stripe webhooks" rule keeps its meaning:
// Stripe remains the single source of truth.
//
// Failure contract: THROWS on errors. The webhook caller rolls back its
// stripe_events claim so Stripe retries; /welcome catches and renders a
// degraded state while the webhook retry heals.

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

// We only sell the single monthly membership now. The 'annual' enum
// value is retained in db/schema/subscriptions.ts for historical rows
// (pre-launch test data) but isn't issued for any new subscription.
function planFromPriceId(priceId: string | undefined): "monthly" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  return null;
}

// Stable UUID-shaped string from a seed, so PostHog can de-dupe an event
// fired by both guest-checkout writers (welcome page + webhook) for the
// same subscription.
function deterministicUuid(seed: string): string {
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export async function mirrorSubscription(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  let [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  if (!user) {
    if (isGuestSubscription(sub)) {
      // Pay-first checkout: no user existed before payment by design.
      // Claim creates the Clerk user from the checkout email and binds
      // the customer to the users mirror row; a failure here throws so
      // the event is retried rather than consumed (a paid customer with
      // no account is the one outcome this flow must never produce).
      const claim = await claimGuestCheckout(sub);
      const [claimed] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.id, claim.userId))
        .limit(1);
      if (!claimed) {
        throw new Error(
          `guest checkout: users row missing right after claim (user ${claim.userId}, sub ${sub.id})`,
        );
      }
      user = claimed;
    } else {
      console.warn("Stripe webhook: no local user for customer", {
        customerId,
      });
      return;
    }
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
  const cancelScheduled = sub.cancel_at_period_end || sub.cancel_at != null;

  // Stripe metadata is string-only; null / undefined slots simply aren't
  // present so fromStripeMetadata returns nulls for missing keys.
  // attribution lives on subscription_data.metadata, set by startCheckout.
  const attribution = fromStripeMetadata(sub.metadata);

  // Read the prior status BEFORE the upsert so we can fire the Meta Purchase
  // event exactly once — on the transition INTO an access-granting state.
  // mirrorSubscription runs on every renewal / invoice.paid / update too, so
  // firing unconditionally here would double-count subscriptions in Ads
  // Manager.
  const [priorRow] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);
  const priorWasAccessGranting = priorRow
    ? (ACCESS_GRANTING_STATUSES as readonly string[]).includes(priorRow.status)
    : false;

  // Guest checkouts bypass the signed-in flow's two duplicate-purchase
  // guards (there was no user to check), so the guard moves here: if this
  // user already holds a DIFFERENT access-granting subscription, do NOT
  // mirror this one — the upsert would push this row into the partial
  // unique index predicate and 500 the webhook forever. Alert-only by
  // deliberate choice (LIVE Stripe, solo operator): the duplicate keeps
  // charging in Stripe until manually refunded/canceled, but the customer
  // keeps access via their original row and nothing crashes. Never
  // auto-refund from a webhook.
  //
  // Keyed on !priorWasAccessGranting (NOT !priorRow): the dangerous write
  // is any TRANSITION into an access-granting status — including the UPDATE
  // path where a non-access-granting row for this sub already exists
  // (e.g. created(incomplete)→'canceled' mirrored first, then a later
  // active edge). !priorRow would skip the guard there and let the
  // onConflictDoUpdate flip it into the index → permanent 500. A guest sub
  // whose OWN row is already access-granting (priorWasAccessGranting=true,
  // i.e. a renewal/update) is safe to update in place — it's the user's
  // single row inside the index predicate.
  if (isGuestSubscription(sub) && grantsAccess && !priorWasAccessGranting) {
    const [other] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, user.id),
          inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
          ne(subscriptions.stripeSubscriptionId, sub.id),
        ),
      )
      .limit(1);
    if (other) {
      console.error(
        "PAY_FIRST_ALERT GUEST CHECKOUT DUPLICATE: user already has an access-granting subscription — new Stripe sub NOT mirrored. User keeps access via the existing row; the duplicate Stripe sub needs a manual refund/cancel.",
        {
          userId: user.id,
          existingRowId: other.id,
          duplicateStripeSubId: sub.id,
          duplicateCustomerId: customerId,
        },
      );
      return;
    }
  }

  await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      stripeSubscriptionId: sub.id,
      status: mappedStatus,
      plan,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: cancelScheduled,
      ...toFirstColumns(attribution.first),
      ...toLastColumns(attribution.last),
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        status: mappedStatus,
        plan,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: cancelScheduled,
        updatedAt: new Date(),
        // Attribution is intentionally NOT updated on conflict — the
        // row was first written at checkout-creation time with the cookies
        // present then. Later subscription updates (renewals, status
        // changes) might land months later with no cookies; we don't
        // want a renewal to erase the original conversion attribution.
      },
    });

  // Meta Conversions API: fire Purchase on the transition INTO an
  // access-granting status. The predicate is derived from the SAME
  // ACCESS_GRANTING_STATUSES set as priorWasAccessGranting (above) — so a sub
  // whose first mirrored status is past_due (e.g. an initial payment that
  // failed then recovered, or a delayed/SCA settlement) still fires exactly
  // once, instead of being dropped because the later active edge sees an
  // already-access-granting prior row.
  //
  // Fired BEFORE markUserTrialsConverted: that step can throw (transient DB
  // error), and on Stripe's retry the prior-status read would then observe the
  // already-committed access-granting row and permanently suppress the
  // Purchase. Firing first — with only pure code between the upsert commit and
  // here — closes that window; event_id=sub.id de-dupes at Meta if a retry
  // ever re-fires. (With the /welcome inline mirror there is additionally a
  // milliseconds-wide two-writer race where BOTH writers see no prior row:
  // Meta still dedupes on event_id; the PostHog event below can in theory
  // double-fire in that window — accepted, posthog-node's captureImmediate
  // has no dedup key.)
  //
  // Gated on the capi_consent sentinel startCheckout writes only with marketing
  // consent. Best-effort: sendCapiEvents never throws and the block is
  // try/caught, so a Meta failure can't roll back the idempotency claim.
  const becameAccessGranting =
    !priorWasAccessGranting &&
    (ACCESS_GRANTING_STATUSES as readonly string[]).includes(mappedStatus);
  if (becameAccessGranting) {
    const amount =
      typeof item?.price.unit_amount === "number"
        ? item.price.unit_amount / 100
        : undefined;
    const currency = item?.price.currency?.toUpperCase();

    // Meta CAPI Purchase — gated on the Meta capi_consent sentinel.
    if (metadataHasCapiConsent(sub.metadata)) {
      try {
        const identity = fromCapiMetadata(sub.metadata);
        const result = await sendCapiEvents([
          {
            eventName: "Purchase",
            eventId: sub.id,
            actionSource: "website",
            eventSourceUrl:
              process.env.NEXT_PUBLIC_APP_URL ?? "https://matio.tv",
            user: {
              email: user.email,
              externalId: user.id,
              fbp: identity.fbp,
              fbc: identity.fbc,
              clientIpAddress: identity.ip,
              clientUserAgent: identity.ua,
            },
            customData: {
              ...(amount !== undefined ? { value: amount } : {}),
              ...(currency ? { currency } : {}),
              content_type: "product",
              content_ids: ["matio-membership"],
            },
          },
        ]);
        if (!result.ok && !result.skipped) {
          console.warn("Meta CAPI Purchase failed", {
            subId: sub.id,
            error: result.error,
          });
        }
      } catch (err) {
        console.warn("Meta CAPI Purchase threw", { subId: sub.id, err });
      }
    }

    // PostHog bottom-of-funnel conversion. Gated on its OWN ph_consent sentinel
    // (NOT capi_consent) so a CAPI-identity capture failure — which would drop
    // capi_consent — can't also blind the first-party funnel. Same transition
    // guard so it still fires exactly once. distinctId = Clerk user id, which
    // the browser already identify()'d — so this server event stitches onto the
    // same person. The deterministic uuid (derived from sub.id) lets PostHog
    // de-dupe the milliseconds-wide guest-checkout double-fire (welcome page
    // and webhook both seeing no prior row). Best-effort: never throws, can't
    // roll back the webhook idempotency claim.
    if (metadataHasPosthogConsent(sub.metadata)) {
      try {
        const result = await captureServerEvent({
          distinctId: user.id,
          event: "subscribe_succeeded",
          uuid: deterministicUuid(`subscribe_succeeded:${sub.id}`),
          properties: {
            ...(amount !== undefined ? { value: amount } : {}),
            ...(currency ? { currency } : {}),
            plan,
            // First-touch UTM (mirrored from Stripe metadata) so bottom-of-funnel
            // conversion is sliceable by campaign without person props.
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
        });
        if (!result.ok && !result.skipped) {
          console.warn("PostHog subscribe_succeeded failed", {
            subId: sub.id,
            error: result.error,
          });
        }
      } catch (err) {
        console.warn("PostHog subscribe_succeeded threw", {
          subId: sub.id,
          err,
        });
      }
    }
  }

  // Once the user has an active (or trialing) subscription, flip every trial
  // session they own to converted = true so the playback path stops gating.
  if (mappedStatus === "active" || mappedStatus === "trialing") {
    await markUserTrialsConverted(user.id);
  }
}
