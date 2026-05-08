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
    muxAssetId: text("mux_asset_id"),
    muxPlaybackId: text("mux_playback_id"),
    status: episodeStatus("status").notNull().default("processing"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [unique("episodes_season_id_number_unique").on(t.seasonId, t.number)],
);

export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;
