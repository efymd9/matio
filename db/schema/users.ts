import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("user"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Per-campaign attribution captured from utm_* cookies on the user's first
  // authenticated touch (/subscribe page render). First-touch is set once
  // and never overwritten — it identifies the campaign that opened the
  // relationship. Last-touch is overwritten on every subsequent
  // authenticated touch where the user lands with utm_* cookies still set;
  // it represents the most recent campaign that re-engaged them. The
  // separate cookie-based attribution on subscriptions captures the
  // exact-conversion-moment last-touch (which marketing platforms expect)
  // — these user-level columns are the right cut for "which campaign
  // brought them into the funnel?".
  attributionFirstSource: text("attribution_first_source"),
  attributionFirstMedium: text("attribution_first_medium"),
  attributionFirstCampaign: text("attribution_first_campaign"),
  attributionLastSource: text("attribution_last_source"),
  attributionLastMedium: text("attribution_last_medium"),
  attributionLastCampaign: text("attribution_last_campaign"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
