import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Tombstones for Stripe customers whose account was erased (art. 17 — Clerk
// `user.deleted`, app/api/webhooks/clerk/route.ts). The erasure deletes the
// `users` row, but the Stripe customer and its subscription outlive it, and
// the subscription's metadata still says `guest = "1"` forever — so the next
// Stripe webhook for that customer (the cancel-at-period-end update, a
// renewal, the final `customer.subscription.deleted`) would walk into
// `claimGuestCheckout` and re-create the Clerk user and the `users` row
// with the address. This table is what the claim path checks first.
//
// Deliberately NO foreign key: the row it would point at is the one being
// deleted, and the tombstone must outlive it. Holds a Stripe customer id
// only — no user id, no address — and is never pruned: "do not resurrect"
// has no expiry (Stripe keeps the customer as a tax record for years, so
// its webhooks can arrive years later). Written write-if-absent
// (ON CONFLICT DO NOTHING) so a Clerk redelivery is a no-op.
export const erasedCustomers = pgTable("erased_customers", {
  stripeCustomerId: text("stripe_customer_id").primaryKey(),
  erasedAt: timestamp("erased_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ErasedCustomer = typeof erasedCustomers.$inferSelect;
