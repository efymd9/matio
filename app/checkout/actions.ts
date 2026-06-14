"use server";

import { auth } from "@clerk/nextjs/server";
import { createAuthCheckoutSession } from "@/app/subscribe/actions";
import { createGuestCheckoutSession } from "@/app/subscribe/guest-actions";
import type {
  CheckoutSessionResult,
  CheckoutTargetInput,
} from "@/lib/checkout-session";

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
  const { userId } = await auth();
  if (userId) return createAuthCheckoutSession(input);
  return createGuestCheckoutSession(input);
}
