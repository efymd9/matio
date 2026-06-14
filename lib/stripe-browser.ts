import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Browser-side Stripe.js loader for Embedded Checkout. loadStripe injects
// js.stripe.com once and must be called outside React render, so we memoize the
// promise at module scope (the @stripe/react-stripe-js docs' recommended
// pattern). When the publishable key is unset the promise resolves to null —
// the checkout action returns a `hosted` result in that case and the client
// full-navigates instead of mounting the iframe, so this is never awaited.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripeBrowser(): Promise<Stripe | null> {
  if (stripePromise === null) {
    const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = pk ? loadStripe(pk) : Promise.resolve(null);
  }
  return stripePromise;
}
