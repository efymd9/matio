import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Browser-side Stripe.js loader for Embedded Checkout. The publishable key is
// provided by the server — the /checkout page reads it at request time and
// passes it as a prop — rather than read from a build-time-inlined NEXT_PUBLIC
// constant, so a key added after the build (or a build-cache-reused client
// bundle) can't leave the client without it. See lib/checkout-session.ts.
//
// loadStripe injects js.stripe.com once and must be called outside React
// render, so we memoize the promise at module scope (the @stripe/react-stripe-js
// recommended pattern). With no key it resolves null — the checkout action
// returns a `hosted` result in that case and the client full-navigates instead
// of mounting the iframe, so this is never awaited then.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripeBrowser(
  publishableKey: string | null,
): Promise<Stripe | null> {
  if (!publishableKey) return Promise.resolve(null);
  if (stripePromise === null) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}
