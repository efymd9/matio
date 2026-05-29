import type Stripe from "stripe";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stripeEvents, subscriptions, users } from "@/db/schema";
import {
  fromStripeMetadata,
  toFirstColumns,
  toLastColumns,
} from "@/lib/attribution";
import { fromCapiMetadata, metadataHasCapiConsent } from "@/lib/capi-identity";
import { sendCapiEvents } from "@/lib/meta-capi";
import { getStripe } from "@/lib/stripe";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";
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

// We only sell the single monthly membership now. The 'annual' enum
// value is retained in db/schema/subscriptions.ts for historical rows
// (pre-launch test data) but isn't issued for any new subscription.
function planFromPriceId(
  priceId: string | undefined,
): "monthly" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  return null;
}

async function mirrorSubscription(sub: Stripe.Subscription) {
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  const [user] = await db
    .select({ id: users.id, email: users.email })
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
  // ever re-fires.
  //
  // Gated on the capi_consent sentinel startCheckout writes only with marketing
  // consent. Best-effort: sendCapiEvents never throws and the block is
  // try/caught, so a Meta failure can't roll back the idempotency claim.
  const becameAccessGranting =
    !priorWasAccessGranting &&
    (ACCESS_GRANTING_STATUSES as readonly string[]).includes(mappedStatus);
  if (becameAccessGranting && metadataHasCapiConsent(sub.metadata)) {
    try {
      const identity = fromCapiMetadata(sub.metadata);
      const amount =
        typeof item?.price.unit_amount === "number"
          ? item.price.unit_amount / 100
          : undefined;
      const currency = item?.price.currency?.toUpperCase();
      const result = await sendCapiEvents([
        {
          eventName: "Purchase",
          eventId: sub.id,
          actionSource: "website",
          eventSourceUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://matio.tv",
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
