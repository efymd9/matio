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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Show = typeof shows.$inferSelect;
export type NewShow = typeof shows.$inferInsert;
