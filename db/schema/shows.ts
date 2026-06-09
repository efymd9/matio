import { sql } from "drizzle-orm";
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const showStatus = pgEnum("show_status", ["draft", "published"]);

// Video orientation for the show's episodes. Drives which watch player chrome
// renders: "horizontal" keeps the standard cinema player; "vertical" uses the
// minimal TikTok-style portrait player. Admin-set per show.
export const showOrientation = pgEnum("show_orientation", [
  "horizontal",
  "vertical",
]);

export const shows = pgTable("shows", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  posterImageUrl: text("poster_image_url"),
  heroImageUrl: text("hero_image_url"),
  genre: text("genre")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  status: showStatus("status").notNull().default("draft"),
  // "horizontal" (default) renders the standard player; "vertical" renders the
  // portrait/TikTok-style player. See lib/i18n and components/watch/player.tsx.
  orientation: showOrientation("orientation").notNull().default("horizontal"),
  // Only one show is the "home hero" at a time; setFeaturedShow enforces.
  featured: boolean("featured").notNull().default(false),
  // Homepage section flags. Independent — a show can be in both, either, or
  // neither. Toggled per-show in the admin edit form. Shows in neither
  // section don't appear on / but are still reachable via /shows/[slug].
  justReleased: boolean("just_released").notNull().default(false),
  popularNow: boolean("popular_now").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
