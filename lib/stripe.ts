import "server-only";
import Stripe from "stripe";

declare global {
  var __stripeClient: Stripe | undefined;
}

// The Stripe API version every call from this app goes out on (#266). Without
// it stripe-node sends whatever version is baked into the INSTALLED package,
// so a routine SDK bump could change the wire contract with no line of ours
// moving — that is how `ui_mode` values were renamed under us once. Two guards
// keep this literal honest: `apiVersion` is typed as the SDK's own literal
// (`pnpm typecheck` fails on a mismatch), and lib/stripe-api-version.test.ts
// compares it with `Stripe.API_VERSION` at runtime. Both go red on a bump that
// moves the version — read that version's changelog, rehearse checkout on
// staging, THEN move the literal. (The webhook endpoint has its own version,
// set in the Stripe dashboard; this constant does not govern it.)
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

// Lazy + cached. The Stripe SDK constructor will throw if the secret is empty.
export function getStripe(): Stripe {
  if (globalThis.__stripeClient) return globalThis.__stripeClient;

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY must be set");
  }

  const client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
  });
  globalThis.__stripeClient = client;
  return client;
}
