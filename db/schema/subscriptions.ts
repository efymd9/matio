import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
    // Separate from updated_at: the latter resets on every status change
    // (e.g. a late customer.subscription.updated webhook), which made the
    // "cancellations in the last 30 days" analytics query meaningless.
    // Existing rows get back-filled from updated_at in the migration so
    // historical churn numbers stay approximately right.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    // Conversion-moment attribution. Snapshotted at Stripe Checkout
    // creation (startCheckout reads the cookies, ships them through
    // Stripe metadata) and persisted here when the webhook mirrors the
    // subscription. This is the cut marketing wants — "which campaign
    // produced this paid subscription?" — independent of the user-level
    // attribution which only captures the original visit.
    attributionFirstSource: text("attribution_first_source"),
    attributionFirstMedium: text("attribution_first_medium"),
    attributionFirstCampaign: text("attribution_first_campaign"),
    attributionLastSource: text("attribution_last_source"),
    attributionLastMedium: text("attribution_last_medium"),
    attributionLastCampaign: text("attribution_last_campaign"),
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
    // Supports listing a user's subscription history (latest first) for
    // /subscribe's AlreadySubscribed lookup and for analytics. The
    // partial unique above covers the access-granting subset only.
    index("subscriptions_user_id_updated_at_idx").on(
      t.userId,
      t.updatedAt.desc(),
    ),
    // /admin/analytics windows "new subs" on created_at (KPI, time series,
    // per-campaign columns) — keeps those range scans off seq scans as the
    // table grows.
    index("subscriptions_created_at_idx").on(t.createdAt),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
