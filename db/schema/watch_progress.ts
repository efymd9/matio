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
    completed: boolean("completed").notNull().default(false),
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
