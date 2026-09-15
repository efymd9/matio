"use server";

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import {
  createAuthCheckoutSession,
  createAuthWalletCheckoutSession,
} from "@/app/subscribe/actions";
import { createGuestCheckoutSession } from "@/app/subscribe/guest-actions";
import { db } from "@/db";
import { users } from "@/db/schema";
import { parseCheckoutSessionParam } from "@/lib/checkout-return";
import type {
  CheckoutSessionResult,
  CheckoutTargetInput,
  WalletCheckoutResult,
} from "@/lib/checkout-session";
import { paymentsEnabled } from "@/lib/free-mode";
import { CHECKOUT_CLAIM_COOKIE } from "@/lib/guest-checkout";
import { getStripe } from "@/lib/stripe";

// Single entry point the in-site /checkout client calls to create a Checkout
// Session. It resolves the auth state SERVER-SIDE (never trusts the client) and
// dispatches: a live Clerk session → the signed-in flow (reuses the Stripe
// customer + userId-keyed duplicate guards); otherwise → the pay-first guest
// flow (which itself returns a redirect bounce when PAY_FIRST_CHECKOUT is off,
// landing anonymous visitors back in the Clerk sign-up auth flow).
//
// Returns a CheckoutSessionResult: `embedded` (client secret → mount the Stripe
// iframe in-page), `hosted` (no publishable key → full-navigate to Stripe), or
// `redirect` (a guard bounce the client performs with router.replace).
export async function createCheckoutSession(
  input: CheckoutTargetInput,
): Promise<CheckoutSessionResult> {
  // Payments off → bounce home. The client handles kind:'redirect' via
  // router.replace, so a /checkout tab open across the flag-flip deploy
  // degrades cleanly instead of erroring.
  if (!paymentsEnabled()) return { kind: "redirect", to: "/" };

  const { userId } = await auth();
  if (userId) return createAuthCheckoutSession(input);
  return createGuestCheckoutSession(input);
}

// Single entry point the paywall's wallet button calls (issue #210). Same
// server-side auth resolution as createCheckoutSession above — the client never
// declares who it is — but v1 answers `unavailable` for anonymous visitors
// instead of dispatching to the guest builder: a wallet purchase by a
// signed-out buyer additionally mints a Clerk account and a sign-in ticket from
// the wallet's email, which is the account-takeover-sensitive path the
// 2026-06-16 webview incident hardened. It gets its own PR and its own bench
// rehearsal. `unavailable` is not an error — the paywall simply keeps the card
// CTA it has today.
export async function createWalletCheckoutSession(
  input: CheckoutTargetInput,
  consentAccepted: boolean,
): Promise<WalletCheckoutResult> {
  if (!paymentsEnabled()) return { kind: "redirect", to: "/" };

  const { userId } = await auth();
  if (!userId) return { kind: "unavailable" };
  return createAuthWalletCheckoutSession(input, consentAccepted);
}

// The /checkout client's refocus probe (#217). Every new checkout expires the
// buyer's OTHER open sessions, so a form left open in a second tab can be dead
// by the time the buyer comes back to it — and Stripe's embedded iframe gives
// us no signal for that. When the tab becomes visible again the client asks
// whether its session is still open; `closed` replaces the dead iframe with the
// retry prompt, and the retry creates a fresh session (which, in turn, closes
// the newer one elsewhere — the tab the buyer is looking at is the live one).
//
// Read-only, and it answers a status word and nothing else — and only about a
// session that is provably the CALLER's: a signed-in buyer's session has to sit
// on their own Stripe customer (the check lib/checkout-return-verify.ts makes
// on the return leg), a guest's has to carry their `checkout_claim` cookie as
// `client_reference_id` (the check /welcome makes before minting a sign-in
// ticket). A caller with neither binding is answered BEFORE Stripe is asked,
// so an anonymous request cannot use this action to make the server look up
// arbitrary `cs_…` ids on its behalf. Every uncertainty — no binding, a
// foreign session, a transient Stripe failure, an id that is not shaped like a
// session id, payments switched off — answers `open`, so a failed probe never
// tears down a form that works; the buyer's own submit still tells the truth.
export async function checkoutSessionState(
  sessionId: string,
): Promise<"open" | "closed"> {
  if (!paymentsEnabled()) return "open";
  const id = parseCheckoutSessionParam(sessionId);
  if (!id) return "open";

  // The cheap checks first: who is asking, and what could their session be
  // bound to. Nothing below touches Stripe until one binding exists.
  const { userId } = await auth();
  let customerId: string | null = null;
  if (userId) {
    const [user] = await db
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    customerId = user?.stripeCustomerId ?? null;
  }
  const claimToken = (await cookies()).get(CHECKOUT_CLAIM_COOKIE)?.value ?? null;
  if (!customerId && !claimToken) return "open";

  try {
    const session = await getStripe().checkout.sessions.retrieve(id);
    const sessionCustomer =
      typeof session.customer === "string"
        ? session.customer
        : (session.customer?.id ?? null);
    const mine =
      (customerId !== null && sessionCustomer === customerId) ||
      (claimToken !== null && session.client_reference_id === claimToken);
    if (!mine) return "open";
    return session.status === "open" ? "open" : "closed";
  } catch {
    return "open";
  }
}
