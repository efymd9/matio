// Single source of truth for which subscription statuses grant access.
// past_due is included so a user whose latest invoice failed isn't
// immediately locked out of the product they're paying for — Stripe
// retries the invoice over several days; during that window the user
// should still be able to watch and to update their card via the
// Customer Portal (which is where they'll go to fix the situation).
//
// Universal on purpose (no `server-only`): the constant is read by the
// account-erasure core (lib/erase-user.ts), which `scripts/erase-user.ts`
// runs under tsx — and a tsx script cannot load a `server-only` module
// (docs/gotchas.md). The app keeps importing it from
// lib/subscription-access.ts, which re-exports it next to
// hasActiveSubscription().
export const ACCESS_GRANTING_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;
