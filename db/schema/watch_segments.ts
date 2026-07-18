import {
  date,
  integer,
  pgTable,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";
import { episodes } from "./episodes";

// Bucket granularity lives in lib/watch-segments.ts (universal — the
// client-side player tracker shares it): bucket = floor(playhead / 10).

// Aggregate audience-retention counters — the YouTube-Studio-style curve.
// One row per (episode, UTC day, 10s bucket); `views` counts how many times
// any viewer's playhead traversed that bucket. Deliberately NOT unique
// viewers: re-crossing a bucket after a seek-back increments again, which
// is exactly what makes rewatch peaks visible on the curve (the player
// dedupes continuous playback so one uninterrupted pass counts once).
// Day-grain keeps the table filterable by period while staying tiny:
// a 15-min episode is 90 buckets/day.
export const watchSegments = pgTable(
  "watch_segments",
  {
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    bucket: integer("bucket").notNull(),
    views: integer("views").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.episodeId, t.day, t.bucket] })],
);

export type WatchSegment = typeof watchSegments.$inferSelect;
