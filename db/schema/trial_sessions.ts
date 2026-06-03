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
    // SHA-256 hex of (client IP || MUX_SIGNING_KEY_PRIVATE_KEY). Used to
    // rate-limit trial-row creation per (IP, show) per hour — stops a user
    // from clearing cookies / opening incognito to mint endless 60s previews.
    // Nullable so existing rows (created before this column) don't need a
    // backfill; the rate-limit query just sees fewer rows for that bucket.
    ipHash: text("ip_hash"),
    // Campaign attribution snapshot taken at row creation (first play of
    // this show on this cookie). First-touch is what was in the
    // attribution_first cookie at that moment; last-touch what was in the
    // attribution_last cookie. Both nullable for organic / direct visits
    // and for rows created before this column existed.
    attributionFirstSource: text("attribution_first_source"),
    attributionFirstMedium: text("attribution_first_medium"),
    attributionFirstCampaign: text("attribution_first_campaign"),
    attributionLastSource: text("attribution_last_source"),
    attributionLastMedium: text("attribution_last_medium"),
    attributionLastCampaign: text("attribution_last_campaign"),
    // 'preview' = legacy 60s-trial row; 'episodes' = episode-gated free-tier
    // row (shows with free_episodes > 0). Explicit discriminator (not derived
    // from the show's current config) so the two funnel populations stay
    // separable even if a show's gating is later turned on/off.
    kind: text("kind")
      .$type<"preview" | "episodes">()
      .notNull()
      .default("preview"),
    // Deepest 1-based episode POSITION started on this session (ordering as
    // in lib/episode-access.ts) — powers the funnel depth distribution.
    // Always 0 for kind='preview'.
    furthestEpisodeNumber: integer("furthest_episode_number")
      .notNull()
      .default(0),
    // Last episode watched — anonymous resume target on gated shows.
    lastEpisodeId: uuid("last_episode_id").references(() => episodes.id, {
      onDelete: "set null",
    }),
    // First time this session hit the sign-up wall (end of free tier or a
    // deep link to a member episode). Stage 3 of the episode funnel.
    signupWallAt: timestamp("signup_wall_at", { withTimezone: true }),
  },
  (t) => [
    unique("trial_sessions_session_token_show_id_unique").on(
      t.sessionToken,
      t.showId,
    ),
    // Supports the rate-limit count: WHERE ip_hash=? AND show_id=? AND
    // started_at > now() - 1h. Leading ip_hash makes the lookup selective
    // since most users won't have many rows for a given show.
    index("trial_sessions_ip_hash_show_id_started_at_idx").on(
      t.ipHash,
      t.showId,
      t.startedAt,
    ),
    // FK indexes: Postgres doesn't auto-index FK columns, so CASCADE
    // deletes from shows / users would do sequential scans without
    // these. show_id is also the cascade target when an admin deletes
    // a show; user_id is hit by linkTrialSessionsToCurrentUser.
    index("trial_sessions_show_id_idx").on(t.showId),
    index("trial_sessions_user_id_idx").on(t.userId),
  ],
);

export type TrialSession = typeof trialSessions.$inferSelect;
export type NewTrialSession = typeof trialSessions.$inferInsert;
