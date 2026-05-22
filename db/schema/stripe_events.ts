import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Idempotency log for Stripe webhook deliveries. Each delivery's event_id
// is inserted before we run the handler; conflicts mean we've already
// processed (or are mid-processing) this event and can safely 200-OK
// without re-applying state. Stripe retries with backoff on non-2xx, so
// a dropped delivery comes back automatically — but a slow original +
// retried delivery can race; the unique constraint resolves the race.
//
// On handler failure we DELETE the row so the next retry can re-attempt.
export const stripeEvents = pgTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StripeEvent = typeof stripeEvents.$inferSelect;
