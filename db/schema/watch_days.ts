import { date, index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { users } from "./users";

// Per-day watch activity ledger: one row per (user, UTC day) with ≥1
// progress save. watch_progress keeps only the LATEST position per
// (user, episode) — it cannot answer "who was active on day X", which is
// what the dashboard's living-audience line (rolling WAU), the
// new/returning/lost balance bars, and the lost-after-7-silent-days
// definition all need. Written by saveWatchProgress as an
// insert-on-conflict-do-nothing — one extra no-op upsert per 10s save
// tick, and the history accrues from the day this ships.
export const watchDays = pgTable(
  "watch_days",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    index("watch_days_day_idx").on(t.day),
  ],
);

export type WatchDay = typeof watchDays.$inferSelect;
