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

// Video shape of a show's episodes. "horizontal" (16:9, the default) uses the
// standard landscape player; "vertical" (9:16 portrait shorts) switches the
// watch page to the TikTok-style minimal player on mobile-width viewports.
// Desktop keeps the standard player either way — it already letterboxes a
// portrait asset into a centered column via the player's dynamic aspect ratio.
export const showOrientation = pgEnum("show_orientation", [
  "horizontal",
  "vertical",
]);
export type ShowOrientation = (typeof showOrientation.enumValues)[number];

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
  // Landscape vs portrait playback. Admin-set per show; default horizontal so
  // every existing show keeps the current player. See showOrientation above.
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
