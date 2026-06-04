import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { seasons } from "./seasons";

export const episodeStatus = pgEnum("episode_status", [
  "processing",
  "ready",
  "errored",
]);

// Who can watch this episode. Replaces the show-level positional counts
// (free_episodes/member_episodes — dropped post-deploy by migration 0015):
//   free       — anyone, anonymous included, full episode
//   member     — any signed-in user (sign-up wall for anonymous)
//   subscriber — active subscription required (the default: new uploads
//                are paid until the admin deliberately opens them)
// A show with ≥1 ready non-subscriber episode is "tier-gated"; a show whose
// ready episodes are ALL subscriber-only keeps the legacy 60s preview.
export const episodeAccess = pgEnum("episode_access", [
  "free",
  "member",
  "subscriber",
]);

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    durationSeconds: integer("duration_seconds"),
    // Intro window in seconds — when both are set, the player surfaces a
    // "Skip intro" chip while currentTime ∈ [intro_start, intro_end].
    // Nullable so existing episodes simply don't show the chip until
    // someone fills them in (admin UI is a follow-up).
    introStartSeconds: integer("intro_start_seconds"),
    introEndSeconds: integer("intro_end_seconds"),
    muxAssetId: text("mux_asset_id"),
    muxPlaybackId: text("mux_playback_id"),
    // "public" | "signed" — set from playback_ids[0].policy in the webhook.
    // Tells the hero/player whether they need a Mux JWT.
    muxPlaybackPolicy: text("mux_playback_policy"),
    status: episodeStatus("status").notNull().default("processing"),
    access: episodeAccess("access").notNull().default("subscriber"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [unique("episodes_season_id_number_unique").on(t.seasonId, t.number)],
);

export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
export type EpisodeAccess = (typeof episodeAccess.enumValues)[number];
