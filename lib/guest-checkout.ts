import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type Stripe from "stripe";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import {
  applyUserAttributionPayload,
  fromStripeMetadata,
} from "@/lib/attribution";
import { getStripe } from "@/lib/stripe";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";
import { linkTrialSessionsByToken } from "@/lib/trial";

// Pay-first ("invisible account") guest checkout. The paywall CTA sends an
// anonymous viewer straight to Stripe Checkout; the account is created
// server-side AFTER payment from the email the buyer typed at Stripe. This
// module owns the claim step: Stripe customer → Clerk user → users mirror
// row. It is idempotent and callable from BOTH writers — the Stripe webhook
// (lib/subscription-mirror.ts no-user branch) and the /welcome success page
// — so whichever runs first wins and the other is a no-op.
//
// Failure contract: this THROWS on Clerk/Stripe/DB errors. In the webhook
// path that rolls back the stripe_events idempotency claim so Stripe
// retries (~3 days of attempts); a warn-and-return here would permanently
// consume the event and strand a paid customer with no account. The
// /welcome caller catches and renders a degraded "still activating" state.

// httpOnly cookie binding the purchasing browser to its Checkout session.
// Mirrored into the session's client_reference_id by startGuestCheckout;
// /welcome only mints a one-click sign-in ticket when cookie === session's
// client_reference_id. WITHOUT that match the page degrades to email-code
// sign-in — NEVER token minting — because the success URL (which carries
// session_id) can leak via history/referrer/share, and a minted ticket is
// an account-takeover primitive.
export const CHECKOUT_CLAIM_COOKIE = "checkout_claim";

export const GUEST_METADATA_KEYS = {
  // "1" marks a subscription born from a guest (pay-first) checkout.
  guest: "guest",
  // The claim token (= client_reference_id = checkout_claim cookie value).
  claimToken: "claim_token",
  // The buyer's trial_session cookie at checkout time, for exact-token
  // trial→paid linkage inside the cookie-less webhook.
  trialToken: "trial_token",
} as const;

export function isGuestSubscription(sub: Stripe.Subscription): boolean {
  return (sub.metadata ?? {})[GUEST_METADATA_KEYS.guest] === "1";
}

export type GuestClaim = {
  userId: string;
  email: string;
  // True ONLY when THIS claim call created a brand-new Clerk account for the
  // checkout email (ensureClerkUser). Per-call and RACE-SENSITIVE: in the
  // welcome-vs-webhook race whichever writer runs first gets created === true
  // and the other sees the existing user (created === false). Kept for
  // observability; the one-click ticket gate now uses `guestBorn` instead.
  created: boolean;
  // Race-proof, attack-proof signal that the bound account was born from THIS
  // checkout — the gate /welcome keys one-click ticket minting on (paired with
  // the checkout_claim cookie that proves "this browser paid"). True when:
  //   - this claim CREATED the Clerk account (created), OR
  //   - the account is already bound to THIS subscription's Stripe customer
  //     with origin 'guest_checkout' (the fast path) — i.e. an earlier claim of
  //     THIS SAME checkout (the welcome-vs-webhook race winner) created it.
  // It is bound to the per-checkout Stripe customer, NOT the bare signup_origin
  // enum: an attacker who types a VICTIM's email at Stripe gets a DIFFERENT
  // customer and resolves to the victim's pre-existing account (created false,
  // not bound to this customer — and a pre-existing guest account is never
  // rebound onto this customer), so guestBorn is false → email-code only, never
  // a minted ticket. Widening this to "any guest_checkout account" reopens
  // account takeover (Stripe doesn't verify email ownership).
  guestBorn: boolean;
};

// Resolve the buyer's email from the Stripe customer the subscription
// belongs to. Guest subscription Checkout always creates the Customer from
// the email typed on the hosted page, so a missing email is an anomaly —
// throw so the webhook retries rather than silently dropping the claim.
async function resolveCustomerEmail(
  customerId: string,
  emailHint?: string | null,
): Promise<string> {
  if (emailHint?.trim()) return emailHint.trim().toLowerCase();
  const customer = await getStripe().customers.retrieve(customerId);
  const email = customer.deleted ? null : customer.email;
  if (!email?.trim()) {
    throw new Error(
      `guest checkout: Stripe customer ${customerId} has no email`,
    );
  }
  return email.trim().toLowerCase();
}

// Find-or-create the Clerk user for this email. createUser can lose a race
// against a concurrent claim (two webhook events processing in parallel) —
// Clerk rejects the duplicate identifier; re-looking-up resolves it.
// Reports whether the account was CREATED here (vs found) — the security
// gate for one-click ticket minting (see GuestClaim.created).
async function ensureClerkUser(
  email: string,
): Promise<{ id: string; created: boolean }> {
  const client = await clerkClient();

  const existing = await client.users.getUserList({ emailAddress: [email] });
  if (existing.data[0]) return { id: existing.data[0].id, created: false };

  try {
    const created = await client.users.createUser({
      emailAddress: [email],
      // The account is passwordless by design: email-code sign-in is the
      // canonical credential (requires "Email verification code" enabled
      // for sign-in on the Clerk production instance).
      skipPasswordRequirement: true,
    });
    return { id: created.id, created: true };
  } catch (err) {
    // Race or Clerk-side duplicate: another writer created the user
    // between our lookup and create. Re-lookup; rethrow the original
    // error if the user genuinely isn't there (Clerk rejected the email).
    // created: false — a concurrent create means WE didn't create it on
    // this call, so this call's caller must not treat it as ticket-safe.
    const retry = await client.users.getUserList({ emailAddress: [email] });
    if (retry.data[0]) return { id: retry.data[0].id, created: false };
    throw err;
  }
}

// Best-effort, idempotent anonymous-funnel stitching: exact-token trial
// linkage + user-level attribution, read back from the same Stripe
// metadata channel the signed-in flow uses. Run on EVERY claim path
// (including the fast path) so a transient failure after the users upsert
// on a prior run is healed by the next retry rather than skipped forever.
async function linkAndAttribute(
  sub: Stripe.Subscription,
  userId: string,
): Promise<void> {
  const trialToken = (sub.metadata ?? {})[GUEST_METADATA_KEYS.trialToken];
  if (trialToken) {
    await linkTrialSessionsByToken(trialToken, userId);
  }
  await applyUserAttributionPayload(userId, fromStripeMetadata(sub.metadata));
}

// Idempotent claim: ensure a Clerk user + users mirror row bound to the
// subscription's Stripe customer, and link the buyer's anonymous trial
// rows / attribution onto the new user. Does NOT write the subscriptions
// row — that stays with mirrorSubscription (single writer of payment
// state), which calls this from its no-user branch.
export async function claimGuestCheckout(
  sub: Stripe.Subscription,
  opts?: { emailHint?: string | null },
): Promise<GuestClaim> {
  if (!isGuestSubscription(sub)) {
    throw new Error(
      `claimGuestCheckout called for non-guest subscription ${sub.id}`,
    );
  }
  const customerId =
    typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Fast path for re-runs (webhook redelivery, welcome-vs-webhook race):
  // the customer is already bound to a user — nothing to bind, but still
  // run the idempotent linkage/attribution in case a prior run failed
  // after the users upsert. created: false — a re-run never re-creates.
  const [bound] = await db
    .select({
      id: users.id,
      email: users.email,
      signupOrigin: users.signupOrigin,
    })
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  if (bound) {
    await linkAndAttribute(sub, bound.id);
    return {
      userId: bound.id,
      email: bound.email,
      created: false,
      guestBorn: bound.signupOrigin === "guest_checkout",
    };
  }

  const email = await resolveCustomerEmail(customerId, opts?.emailHint);
  const { id: userId, created } = await ensureClerkUser(email);

  // Decide whether to (re)point users.stripeCustomerId at THIS customer.
  // A returning CHURNED user re-buying as a guest should rebind so
  // /api/billing-portal opens the customer that owns the LIVE sub. But a
  // user who STILL holds an access-granting subscription must NOT be
  // rebound: that would orphan the original (non-guest) subscription's
  // webhook mirroring — its events resolve the user by the OLD customer,
  // hit warn-and-return, freeze currentPeriodEnd, and the customer loses
  // access at period end while still being charged. The duplicate guard in
  // mirrorSubscription then refuses to mirror this guest sub anyway, so
  // keeping the original binding is correct.
  const [existingMirror] = await db
    .select({
      stripeCustomerId: users.stripeCustomerId,
      signupOrigin: users.signupOrigin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  let rebind = true;
  if (
    existingMirror?.stripeCustomerId &&
    existingMirror.stripeCustomerId !== customerId
  ) {
    if (existingMirror.signupOrigin === "guest_checkout") {
      // SECURITY: never repoint a pre-existing guest_checkout account onto a
      // DIFFERENT customer. The one-click ticket fast path keys on
      // (stripeCustomerId === this customer AND origin === 'guest_checkout');
      // rebinding a guest account to THIS checkout's customer would make a
      // victim's account ticket-eligible and enable account takeover via a
      // guest checkout typed against their email. This rebind only ever served
      // the rare churned guest re-buyer's billing portal — they sign in via
      // email-code instead (safe), and their new sub still mirrors onto the
      // account via the userId path in mirrorSubscription.
      rebind = false;
    } else {
      // clerk_signup account: rebinding is safe for the ticket gate (origin
      // stays clerk_signup → never guestBorn). Keep the original guard: don't
      // orphan an account that still holds an access-granting sub on its
      // current customer (its webhook mirroring resolves the user by that
      // customer; the duplicate guard refuses this guest sub anyway).
      const [accessRow] = await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, userId),
            inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
          ),
        )
        .limit(1);
      if (accessRow) rebind = false;
    }
  }

  // Mirror row. Shapes handled:
  //  - no row for this Clerk id → insert (normal guest case; also beats
  //    the Clerk user.created webhook, same as getOrSyncCurrentUser)
  //  - row exists for this id, churned re-buyer (rebind) → repoint
  //    stripeCustomerId to the live customer
  //  - row exists for this id, still an active subscriber (rebind=false)
  //    → leave the binding alone (onConflictDoNothing)
  //  - row exists with this EMAIL under a DIFFERENT id (stale mirror of a
  //    deleted-and-recreated Clerk user) → the insert's email-unique
  //    violation lands in the catch; surface it loudly instead of
  //    guessing, since silently re-keying a users PK would cascade into
  //    subscriptions/trials FKs.
  try {
    // signup_origin only lands on INSERT — an existing row (returning
    // churned user) keeps its original origin; the rebind path never
    // rewrites it.
    const insert = db.insert(users).values({
      id: userId,
      email,
      stripeCustomerId: customerId,
      // 'guest_checkout' ONLY when THIS claim created the Clerk account
      // (ensureClerkUser → created). A pre-existing Clerk user that merely
      // lacked a mirror row (created === false) is a real interactive identity
      // — stamp 'clerk_signup' so guestBorn (and thus one-click ticket minting)
      // never mistakes it for guest-born. The normal guest case is created.
      signupOrigin: created ? "guest_checkout" : "clerk_signup",
    });
    await (rebind
      ? insert.onConflictDoUpdate({
          target: users.id,
          set: { stripeCustomerId: customerId },
        })
      : insert.onConflictDoNothing({ target: users.id }));
  } catch (err) {
    const [byEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (byEmail && byEmail.id !== userId) {
      throw new Error(
        `PAY_FIRST_ALERT guest checkout: users row for ${email} exists under stale id ${byEmail.id} (live Clerk id ${userId}) — manual re-key needed`,
      );
    }
    throw err;
  }

  await linkAndAttribute(sub, userId);

  // guestBorn (ticket-eligible) on the MAIN path = `created` ONLY — a brand-new
  // Clerk account born from THIS checkout. We deliberately do NOT widen this to
  // a pre-existing guest_checkout account (created === false): an attacker who
  // types a VICTIM's email at Stripe and pays reaches this main path with
  // created === false and the victim's userId, so trusting the persisted origin
  // would mint a one-click ticket onto the victim. The legit welcome-vs-webhook
  // race (the bug this change fixes) is covered by the FAST PATH above instead:
  // the race-winning writer creates the row bound to THIS customerId with origin
  // 'guest_checkout', so the second writer finds it there (bound === this exact
  // checkout's customer) and returns guestBorn true — never a victim, because a
  // pre-existing guest account is never rebound onto this customer (see rebind).
  const guestBorn = created;

  return { userId, email, created, guestBorn };
}
