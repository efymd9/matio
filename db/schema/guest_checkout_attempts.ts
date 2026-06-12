import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// Per-(IP hash, clock-hour) counter that rate-limits the UNAUTHENTICATED guest
// checkout action (app/subscribe/guest-actions.ts:startGuestCheckout). That
// action creates a live Stripe Checkout Session and fires Meta CAPI / PostHog
// events on every call, with no natural throttle for a cookieless script (each
// request gets a fresh claim token → a fresh Stripe idempotency key → a fresh
// session). The counter caps attempts per IP per hour so a flood can't
// (a) pollute the Meta/PostHog ad-conversion signal, (b) exhaust Stripe's API
// rate limit and break checkout for real buyers, or (c) run up Vercel/Neon
// cost. IP hashing reuses the trial limiter's HMAC bucket — no raw IPs stored.
// Self-pruned (rows older than 2h) by the limiter; see lib/checkout-rate-limit.
export const guestCheckoutAttempts = pgTable(
  "guest_checkout_attempts",
  {
    ipHash: text("ip_hash").notNull(),
    // Truncated to the clock hour; (ip_hash, window_start) is the fixed-window
    // bucket key for the hourly counter.
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.ipHash, t.windowStart] })],
);

export type GuestCheckoutAttempt = typeof guestCheckoutAttempts.$inferSelect;
