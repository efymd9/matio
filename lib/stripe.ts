import "server-only";
import Stripe from "stripe";

declare global {
  var __stripeClient: Stripe | undefined;
}

// Lazy + cached. The Stripe SDK constructor will throw if the secret is empty.
export function getStripe(): Stripe {
  if (globalThis.__stripeClient) return globalThis.__stripeClient;

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY must be set");
  }

  const client = new Stripe(process.env.STRIPE_SECRET_KEY);
  globalThis.__stripeClient = client;
  return client;
}
