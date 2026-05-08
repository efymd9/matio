import {
  boolean,
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
    unique("watch_progress_user_id_episode_id_unique").on(t.userId, t.episodeId),
  ],
);

export type WatchProgress = typeof watchProgress.$inferSelect;
export type NewWatchProgress = typeof watchProgress.$inferInsert;
