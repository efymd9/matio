import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { episodes } from "./episodes";
import { users } from "./users";

export const watchProgress = pgTable(
  "watch_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    positionSeconds: integer("position_seconds").notNull().default(0),
    // Monotonic furthest playhead (GREATEST on every save). position_seconds
    // is the resume target and regresses when the user seeks back — depth
    // metrics (≥25/50/80% milestones, deep completion) must read this
    // instead. Backfilled from position_seconds by migration — pre-existing
    // rows undercount if the user last saved mid-rewind.
    maxPositionSeconds: integer("max_position_seconds").notNull().default(0),
    // Cumulative seconds actually watched, accumulated by the segment-flush
    // action (10s bucket granularity, rewatches included — can exceed the
    // episode duration). 0 for rows that predate segment tracking.
    totalWatchedSeconds: integer("total_watched_seconds").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    // When this user FIRST started this episode — release retention needs
    // "watched ep N+1 within N days of its release", which updated_at
    // (overwritten every save) cannot answer. Backfilled from updated_at,
    // so pre-migration rows carry last-touch as an approximation.
    firstWatchedAt: timestamp("first_watched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The composite unique on (user_id, episode_id) covers user-scoped
    // lookups (leading column = user_id) and the watch-page's resume
    // query, but joins from episodes → watch_progress and admin
    // analytics' "top shows" group-by both pivot on episode_id alone,
    // which Postgres can't satisfy from the composite. A standalone
    // index on episode_id avoids sequential scans at scale.
    unique("watch_progress_user_id_episode_id_unique").on(t.userId, t.episodeId),
    index("watch_progress_episode_id_idx").on(t.episodeId),
  ],
);

export type WatchProgress = typeof watchProgress.$inferSelect;
export type NewWatchProgress = typeof watchProgress.$inferInsert;
