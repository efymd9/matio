import { sql } from "drizzle-orm";
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const subscriptionStatus = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "trialing",
]);

export const subscriptionPlan = pgEnum("subscription_plan", [
  "monthly",
  "annual",
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    status: subscriptionStatus("status").notNull(),
    plan: subscriptionPlan("plan").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Schema-level guarantee that a user can have at most one active-ish
    // subscription at any moment. Historic rows (status='canceled') stay,
    // so the trail of past subscriptions is preserved — only one row per
    // user can carry an access-granting status. Without this index, a
    // race in the Stripe webhook delivery order (subscription.created for
    // the new sub lands before subscription.deleted for the old one) can
    // leave two active rows; our subscriber-check queries .limit(1) and
    // the wrong row can win on arbitrary tuple order.
    uniqueIndex("subscriptions_active_user_id_unique")
      .on(t.userId)
      .where(sql`status IN ('active','trialing','past_due')`),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
