import { verifyWebhook } from "@clerk/nextjs/webhooks";
import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, inArray, or } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import {
  erasedCustomers,
  showReminders,
  subscriptions,
  users,
} from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";

// Webhooks run on Node, not Edge — verifyWebhook needs the raw request body
// and we hit Postgres via postgres-js.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    console.error("Clerk webhook signature verification failed:", err);
    return new Response("Bad signature", { status: 400 });
  }

  if (evt.type === "user.created") {
    const data = evt.data;
    const email =
      data.email_addresses.find((e) => e.id === data.primary_email_address_id)
        ?.email_address ?? data.email_addresses[0]?.email_address;

    if (!email) {
      // No email to mirror. Real email-signup users always have one;
      // this hits for Clerk's "Send Example" test payload and any
      // phone/username-only signup. Acknowledge with 200 so Clerk
      // doesn't retry an event we can't act on — getOrSyncCurrentUser
      // backfills the row on the first authenticated /subscribe hit
      // regardless.
      console.warn("user.created event has no email — skipping", {
        id: data.id,
      });
      return new Response("OK (no email, skipped)", { status: 200 });
    }

    // onConflictDoNothing makes this idempotent — Clerk retries failed webhooks.
    await db
      .insert(users)
      .values({ id: data.id, email })
      .onConflictDoNothing({ target: users.id });
  }

  if (evt.type === "user.deleted") {
    return eraseDeletedUser(evt.data.id);
  }

  return new Response("OK", { status: 200 });
}

// Art. 17 GDPR for our database. Clerk is the source of truth for the
// account: deleting it there (UserProfile → "Delete account", the dashboard,
// or our own hand-run erasure request) is the ONE trigger, and this handler
// is the ONE mechanism — a manual request is executed by deleting the user
// in Clerk, never by SQL. The payload carries only the id (no email), and one
// DELETE on the mirror row takes everything hanging off it with it through
// the FK actions declared in db/schema/* (route.test.ts pins them):
// CASCADE — subscriptions, watch_progress, watch_days; SET NULL —
// trial_sessions, visitors (visit history stays, de-identified),
// marketing_links.created_by. show_reminders is the one PII table keyed on
// the address rather than the account, so it is erased here explicitly.
//
// Stripe is the one processor this handler reaches (#164): a live
// subscription is set to cancel at period end (best-effort — the erasure
// never waits for Stripe), and the customer id is tombstoned in
// erased_customers BEFORE the users row goes, so the customer's later
// webhooks cannot re-create the account through claimGuestCheckout. The
// Stripe Customer itself is NOT deleted here — whether to `customers.del`
// (invoices are Stripe's own tax records either way) is the owner's call,
// tracked in docs/registry.md.
async function eraseDeletedUser(userId: string | undefined) {
  if (!userId) {
    // Clerk's "Send Example" payload and any malformed delivery: nothing to
    // act on and nothing a retry would fix — acknowledge (same stance as the
    // emailless user.created above).
    console.warn("user.deleted event has no id — skipping");
    return new Response("OK (no id, skipped)", { status: 200 });
  }

  const [user] = await db
    .select({ email: users.email, stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    // Already erased (Clerk redelivers on timeouts) or never mirrored —
    // either way the end state holds. Idempotent 200.
    return new Response("OK (already erased)", { status: 200 });
  }

  // Money guard. A live Stripe subscription outlives the account — Stripe
  // keeps billing a customer who can no longer sign in. The subscription is
  // set to cancel at the end of the paid period (the viewer keeps what they
  // paid for; nothing is charged after). `cancel_at_period_end: true` is
  // idempotent at Stripe — a Clerk redelivery that reaches this point again
  // re-sets the same flag. Best-effort: a Stripe failure must not stop the
  // erasure (the account is the thing the user asked to be rid of), but it
  // must not be silent either — the ids (never the address) go to the log
  // AND to Sentry, because Vercel logs live a day and Sentry drops console
  // breadcrumbs wholesale. A short request timeout keeps a slow Stripe from
  // eating the function budget the DELETEs below still need.
  const [liveSub] = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
        gt(subscriptions.currentPeriodEnd, new Date()),
      ),
    )
    .limit(1);
  let cancelRequested = false;
  if (liveSub) {
    const ids = {
      userId,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: liveSub.stripeSubscriptionId,
    };
    try {
      await getStripe().subscriptions.update(
        liveSub.stripeSubscriptionId,
        { cancel_at_period_end: true },
        { timeout: STRIPE_CANCEL_TIMEOUT_MS },
      );
      cancelRequested = true;
      console.info(
        "Clerk user.deleted: live Stripe subscription set to cancel at period end",
        ids,
      );
    } catch (err) {
      // Stripe's error text is not echoed: it quotes request parameters,
      // and the log-audit only allows ids and statuses through. Name, code
      // and HTTP status are enough to tell "no such subscription" from
      // "Stripe is down".
      console.error(
        "Clerk user.deleted: could NOT schedule the live Stripe subscription's cancellation — cancel it at Stripe by hand",
        { ...ids, error: describeStripeError(err) },
      );
    }
    Sentry.captureMessage(
      cancelRequested
        ? "clerk user.deleted: live Stripe subscription set to cancel at period end"
        : "clerk user.deleted: live Stripe subscription NOT cancelled — cancel by hand",
      {
        level: cancelRequested ? "info" : "error",
        tags: {
          userId,
          stripeSubscriptionId: liveSub.stripeSubscriptionId,
          cancelRequested: String(cancelRequested),
        },
      },
    );
  }

  // Tombstone the Stripe customer BEFORE the users row goes: from here on
  // the customer's webhooks (the cancel-at-period-end update just
  // requested, a renewal, the final subscription.deleted) find no local
  // user, and a guest sub's `guest = "1"` metadata would otherwise send them
  // into claimGuestCheckout to re-create the account. Write-if-absent, so a
  // redelivery is a no-op; a failure here throws (500 → Clerk retries) —
  // unlike the Stripe call above, this row is what makes the erasure stick.
  if (user.stripeCustomerId) {
    await db
      .insert(erasedCustomers)
      .values({ stripeCustomerId: user.stripeCustomerId })
      .onConflictDoNothing({ target: erasedCustomers.stripeCustomerId });
  }

  // No transaction around the two DELETEs — on purpose: the only partial
  // state a crash between them can leave is "reminders gone, users row still
  // here", i.e. too much erased, never a surviving address; the 500 makes
  // Clerk retry and the retry converges (reminders already gone, users found
  // and deleted). The order matters: reminders first, or SET NULL would cut
  // the user_id link before the explicit delete can use it.

  // "Delete my account" erases the reminder requests too: every row for the
  // account's address (the same reach as unsubscribeEmail — the address IS
  // the subscription) plus any row the account linked under another
  // address. This runs BEFORE the users DELETE, because the FK's SET NULL
  // would drop that link first. Reminder addresses are stored lowercased.
  const reminders = await db
    .delete(showReminders)
    .where(
      or(
        eq(showReminders.email, user.email.toLowerCase()),
        eq(showReminders.userId, userId),
      ),
    )
    .returning({ id: showReminders.id });

  await db.delete(users).where(eq(users.id, userId));

  console.info("Clerk user.deleted: local data erased", {
    userId,
    reminderRows: reminders.length,
    stripeCustomer: user.stripeCustomerId !== null,
    liveSubscription: liveSub !== undefined,
    cancelRequested,
  });
  return new Response("OK", { status: 200 });
}

// Per-request ceiling for the cancel-at-period-end call. Stripe answers in
// well under a second; the ceiling exists so a Stripe stall cannot consume
// the whole function budget before the local DELETEs run.
const STRIPE_CANCEL_TIMEOUT_MS = 5_000;

// The loggable shape of a failed Stripe call: class, Stripe error code and
// HTTP status — never the message, which quotes what was sent.
function describeStripeError(err: unknown) {
  const e = err as { name?: unknown; code?: unknown; statusCode?: unknown };
  return {
    name: typeof e?.name === "string" ? e.name : "unknown",
    code: typeof e?.code === "string" ? e.code : undefined,
    statusCode: typeof e?.statusCode === "number" ? e.statusCode : undefined,
  };
}
