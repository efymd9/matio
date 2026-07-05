import "server-only";

// Payments kill-switch for the 2026-07 free pivot. Payments are OFF unless
// PAYMENTS_ENABLED=1 is set — with the flag unset, every episode plays as the
// existing `free` tier for everyone (anonymous included), the paywall /
// signup-wall / 60s-trial surfaces never render, and /subscribe + /checkout
// redirect home. All Stripe/trial machinery stays in the codebase and in the
// DB untouched; setting PAYMENTS_ENABLED=1 and redeploying restores paid mode
// with zero code changes.
//
// Deliberately NOT consulted by the Stripe webhook / subscription-mirror path:
// existing subscriptions keep mirroring (renewals, cancellations, the guest
// duplicate guard) regardless of the flag, so subscription state stays true
// while payments are off.
//
// Server-only: client components never read this — server components branch
// and pass the outcome down as props, so the flag can't be stranded in a
// build-inlined client bundle (same reasoning as lib/checkout-session.ts).
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS_ENABLED === "1";
}
