import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shows } from "./shows";
import { users } from "./users";

// Cookie-based, anonymous-first trial. One row per (browser session, show).
// On signup, userId is linked. On Stripe success, converted flips to true.
export const trialSessions = pgTable(
  "trial_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionToken: text("session_token").notNull(),
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    converted: boolean("converted").notNull().default(false),
    lastPositionSeconds: integer("last_position_seconds").notNull().default(0),
  },
  (t) => [
    unique("trial_sessions_session_token_show_id_unique").on(
      t.sessionToken,
      t.showId,
    ),
  ],
);

export type TrialSession = typeof trialSessions.$inferSelect;
export type NewTrialSession = typeof trialSessions.$inferInsert;
