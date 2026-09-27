import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shows } from "./shows";

// What a fan pitched on /ideas: the continuation of a published series, or a
// brand-new one. The public form sends the series slug or "new"
// (lib/idea-submission.ts:NEW_SERIES_VALUE); the action maps it here.
export const ideaKind = pgEnum("idea_kind", ["continuation", "new_series"]);
export type IdeaKind = (typeof ideaKind.enumValues)[number];

// Story ideas sent through the public /ideas landing (#297) —
// app/(public)/ideas/actions.ts:submitIdea is the only writer. Anonymous by
// design: no account is needed to send an idea, so a row is identified by
// its address alone.
//
// Deliberately NOT here (data minimisation — the /gdpr data map):
//   - no user id and no FK on `users`, on purpose. A fan does not need an
//     account, and an FK would only ever be null. That also means the users
//     FK map pinned by app/api/webhooks/clerk/route.test.ts does not change
//     and cannot catch a missed erasure step: the account erasure
//     (lib/erase-user.ts:eraseUser) deletes these rows by the account's
//     address EXPLICITLY, before the users row goes — only that step erases
//     them;
//   - no IP hash and no country: the IP is needed by the hourly submit brake
//     only, and it lives in that counter (guest_checkout_attempts, key
//     `idea:` + HMAC of the IP), never on the row;
//   - no "18+" or "accepted the terms" booleans and no marketing_opt_in_at:
//     the consent record IS the row — it cannot exist without both ticks —
//     plus terms_version plus created_at. Flags that are always true and a
//     second clock would be a second, contestable answer to the same
//     question (the #214 precedent). The insert is ON CONFLICT DO NOTHING,
//     so marketing_opt_in is never rewritten and its moment is created_at;
//   - no selected_at: v1 has no exception for "selected" ideas — every row
//     goes 24 months after created_at (lib/retention.ts; registry row).
export const ideaSubmissions = pgTable(
  "idea_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: ideaKind("kind").notNull(),
    // Set for a continuation only. SET NULL: a hard-deleted show must not
    // take a fan's idea with it (shows are soft-deleted in practice).
    showId: uuid("show_id").references(() => shows.id, { onDelete: "set null" }),
    // NULL when the fan left it blank (an empty string is stored as NULL).
    workingTitle: text("working_title"),
    logline: text("logline").notNull(),
    story: text("story").notNull(),
    // Name or pen name — how the on-screen credit should read.
    authorName: text("author_name").notNull(),
    // Trimmed and lowercased before the insert: erasure, export and the
    // unsubscribe path all compare against lower(address).
    email: text("email").notNull(),
    // Site locale at submission time.
    locale: text("locale").notNull().default("en"),
    // Version of the texts the fan agreed to — the Idea Submission Terms and
    // the wording of the three ticks (lib/idea-submission.ts:
    // IDEA_TERMS_VERSION). Always stamped by the server, never taken from
    // the client.
    termsVersion: text("terms_version").notNull(),
    // Tick 3: emails about new episodes and future story calls. Nothing
    // sends them yet; unsubscribing (lib/email-unsubscribe.ts) resets it.
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    // sha256 hex of the normalised pitch (kind, show, title, logline,
    // story) — with the address, the natural key a double tap or a retry
    // collapses on.
    contentHash: text("content_hash").notNull(),
    // Campaign snapshot from the attribution cookies at submission time
    // (same names as users / trial_sessions, so toFirstColumns /
    // toLastColumns apply). Those cookies exist only under marketing
    // consent — NULL without it.
    attributionFirstSource: text("attribution_first_source"),
    attributionFirstMedium: text("attribution_first_medium"),
    attributionFirstCampaign: text("attribution_first_campaign"),
    attributionLastSource: text("attribution_last_source"),
    attributionLastMedium: text("attribution_last_medium"),
    attributionLastCampaign: text("attribution_last_campaign"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The ON CONFLICT target of submitIdea. Its leading `email` column also
    // serves the by-address lookups of erasure and export.
    unique("idea_submissions_email_content_hash_unique").on(
      t.email,
      t.contentHash,
    ),
    // Admin list order (newest first) and the retention cron's window scan.
    index("idea_submissions_created_at_idx").on(t.createdAt),
  ],
);

export type IdeaSubmission = typeof ideaSubmissions.$inferSelect;
export type NewIdeaSubmission = typeof ideaSubmissions.$inferInsert;
