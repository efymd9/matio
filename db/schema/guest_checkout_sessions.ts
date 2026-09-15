import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The last live Checkout Session of each pay-first GUEST buyer (#224) — the
// guest half of the "not more than one open, billable session per buyer"
// invariant (ADR 0002). A signed-in buyer's other sessions are found at Stripe
// by `checkout.sessions.list({ customer, status: "open" })`; a guest has no
// Stripe customer before payment and Stripe's list cannot filter by
// `client_reference_id`, so the previous session id is remembered HERE and
// expired by id: `lib/guest-checkout-sessions.ts:claimSoleGuestSession`
// swaps in the new id and hands back the old one in a single statement.
//
// Keyed by an HMAC of the `checkout_claim` cookie value (same salt as the
// trial IP hash), never the value itself: that cookie is what /welcome
// compares against `client_reference_id` before minting a sign-in ticket, and
// a table holding it in the clear would be a table of sign-in tickets. Holds
// no e-mail and no user id — a guest has neither yet. Rows outlive their use
// by at most a day (a Checkout Session lives ≤ 24h) and are self-pruned by the
// claim helper; not a `lib/retention.ts` policy because nothing in it is
// personal data promised a window in /privacy — it is a technical key.
export const guestCheckoutSessions = pgTable("guest_checkout_sessions", {
  claimTokenHash: text("claim_token_hash").primaryKey(),
  sessionId: text("session_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GuestCheckoutSession = typeof guestCheckoutSessions.$inferSelect;
