"use server";

import { auth } from "@clerk/nextjs/server";
import {
  createAuthCheckoutSession,
  createAuthWalletCheckoutSession,
} from "@/app/subscribe/actions";
import { createGuestCheckoutSession } from "@/app/subscribe/guest-actions";
import type {
  CheckoutSessionResult,
  CheckoutTargetInput,
  WalletCheckoutResult,
} from "@/lib/checkout-session";
import { paymentsEnabled } from "@/lib/free-mode";

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
  waiverAccepted: boolean,
): Promise<WalletCheckoutResult> {
  if (!paymentsEnabled()) return { kind: "redirect", to: "/" };

  const { userId } = await auth();
  if (!userId) return { kind: "unavailable" };
  return createAuthWalletCheckoutSession(input, waiverAccepted);
}
