import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { shows } from "./shows";

// Virtual actors — a global roster, reusable across shows (the same virtual
// actor can appear in several series). Content fields are single-language,
// matching how show titles/descriptions work (only UI chrome is bilingual).
export const actors = pgTable("actors", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Public URL segment: /actors/<slug>. Same charset rule as shows.slug.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  // One-line archetype ("AI femme fatale") — shown under the name in the
  // show-page cast section and popup.
  tagline: text("tagline"),
  // Longer blurb for the hover popup + the /actors/[slug] profile page.
  bio: text("bio"),
  // Admin-uploaded square avatar (Vercel Blob, actors/avatar-*), same
  // pipeline as show poster/hero artwork.
  avatarImageUrl: text("avatar_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Show ↔ actor link. `characterName` is the per-show "as <character>" credit;
// `position` drives the admin-controlled display order within a show's cast.
export const showActors = pgTable(
  "show_actors",
  {
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    characterName: text("character_name"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.showId, t.actorId] }),
    // Reverse lookup for the /actors/[slug] "appears in" list.
    index("show_actors_actor_id_idx").on(t.actorId),
  ],
);

export type Actor = typeof actors.$inferSelect;
export type NewActor = typeof actors.$inferInsert;
export type ShowActor = typeof showActors.$inferSelect;
