import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const showStatus = pgEnum("show_status", ["draft", "published"]);

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
  // Only one show is the "home hero" at a time; setFeaturedShow enforces.
  featured: boolean("featured").notNull().default(false),
  // Homepage section flags. Independent — a show can be in both, either, or
  // neither. Toggled per-show in the admin edit form. Shows in neither
  // section don't appear on / but are still reachable via /shows/[slug].
  justReleased: boolean("just_released").notNull().default(false),
  popularNow: boolean("popular_now").notNull().default(false),
  // Episode-gated free tier (microdrama model). Positions are 1-based within
  // the show's READY episodes ordered by (season number, episode number):
  //   position <= free_episodes                      → playable by anyone
  //   position <= free_episodes + member_episodes    → any signed-in user
  //   beyond                                         → subscribers only
  // Both 0 (the default) → the legacy 60-second preview trial applies.
  freeEpisodes: integer("free_episodes").notNull().default(0),
  memberEpisodes: integer("member_episodes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
