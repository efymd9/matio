import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { parseCheckoutSessionParam } from "@/lib/checkout-return";
import { paymentsEnabled } from "@/lib/free-mode";
import { getStripe } from "@/lib/stripe";
import { mirrorSubscription } from "@/lib/subscription-mirror";

export type VerifiedCheckoutReturn = {
  // The Stripe subscription id — the same key the server-side Meta Purchase
  // (CAPI) uses, so a future OpenAI Conversions-API call dedupes against the
  // browser beacon by construction.
  subscriptionId: string;
  // What Stripe actually charged today, in cents (the $1 trial fee; tax on
  // top once a registration exists).
  amountCents: number;
  currency: string;
};

// The signed-in checkout return (`?cs=<Checkout Session>` on the watch page or
// the home fallback), verified the way /welcome verifies the guest return:
// the session must exist at Stripe, be a completed PAID subscription
// checkout, and belong to THIS signed-in user (its customer is the user's
// Stripe customer) — a forged or someone else's id yields nothing, so the
// beacon cannot be used to fabricate conversions. While we hold the expanded
// subscription we also run the idempotent mirror, which closes the
// "redirect lands before the webhook" race for signed-in buyers exactly as
// /welcome closes it for guests: the page renders the subscriber state on
// the very first paint. The webhook stays the source of truth; a mirror
// failure here is logged by id and swallowed — never a broken page.
export async function verifyCheckoutReturn(
  cs: unknown,
  userId: string | null,
): Promise<VerifiedCheckoutReturn | null> {
  if (!paymentsEnabled() || !userId) return null;
  const sessionId = parseCheckoutSessionParam(cs);
  if (!sessionId) return null;

  let session;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
  } catch {
    return null;
  }
  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid"
  ) {
    return null;
  }
  const sub = session.subscription;
  if (!sub || typeof sub === "string") return null;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : (session.customer?.id ?? null);
  if (!customerId) return null;

  const [user] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.stripeCustomerId !== customerId) return null;

  try {
    await mirrorSubscription(sub);
  } catch {
    // Ids only — never the customer object or its email.
    console.error("checkout return: inline mirror failed", {
      subscriptionId: sub.id,
    });
  }

  return {
    subscriptionId: sub.id,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
  };
}
