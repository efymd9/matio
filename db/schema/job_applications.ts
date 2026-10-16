import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
// Relative, not `@/`: drizzle-kit loads this file outside the app's path aliases.
import { JOB_POSITIONS } from "../../lib/careers";
import type { JobSocialLink } from "../../lib/job-application";

// The role an application is for — the vacancy ids of lib/careers.ts. A new
// role in code needs `ALTER TYPE … ADD VALUE` here first (a migration).
export const jobPosition = pgEnum("job_position", JOB_POSITIONS);
export type JobPositionValue = (typeof jobPosition.enumValues)[number];

// Applications sent through the public /careers page (#376) —
// app/(public)/careers/actions.ts:submitJobApplication is the only writer.
// Anonymous by design: no account is needed to apply, so a row is
// identified by its address alone.
//
// Deliberately NOT here (data minimisation — the /gdpr data map):
//   - no user id and no FK on `users`, on purpose (the idea_submissions
//     precedent). The users FK map pinned by app/api/webhooks/clerk/
//     route.test.ts does not change and cannot catch a missed erasure step:
//     the account erasure (lib/erase-user.ts:eraseUser) deletes these rows by
//     the account's address EXPLICITLY, before the users row goes;
//   - no IP hash and no country: the IP is needed by the hourly submit brake
//     only, and it lives in that counter (guest_checkout_attempts, key `job:`
//     + HMAC of the IP bucket), never on the row;
//   - no "18+" boolean: the row cannot exist without the tick;
//   - no files, no attribution, no locale, no status column — candidate
//     statuses (new / shortlisted / rejected) are a registry row.
// Every row goes 6 months after created_at (lib/retention.ts).
export const jobApplications = pgTable(
  "job_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    position: jobPosition("position").notNull(),
    fullName: text("full_name").notNull(),
    // Trimmed and lowercased before the insert: erasure, export and the
    // by-address scripts all compare against lower(address).
    email: text("email").notNull(),
    // "Where are you based?" — free text the candidate types (City, country).
    location: text("location").notNull(),
    // http(s) only — the scheme is checked on the server
    // (lib/job-application.ts:isHttpLink). NULL when left blank.
    linkedinUrl: text("linkedin_url"),
    portfolioUrl: text("portfolio_url"),
    // 0–4 rows of {platform, value}: an @handle or an http(s) link.
    socialLinks: jsonb("social_links")
      .$type<JobSocialLink[]>()
      .notNull()
      .default([]),
    message: text("message").notNull(),
    // sha256 hex of the normalised application (name, location, links,
    // profiles, message) — with the address and the position, the natural
    // key a double tap or a retry collapses on.
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The ON CONFLICT target of submitJobApplication. Its leading `email`
    // column also serves the by-address lookups of erasure and export.
    unique("job_applications_email_position_content_hash_unique").on(
      t.email,
      t.position,
      t.contentHash,
    ),
    // Admin list order (newest first) and the retention cron's window scan.
    index("job_applications_created_at_idx").on(t.createdAt),
  ],
);

export type JobApplication = typeof jobApplications.$inferSelect;
export type NewJobApplication = typeof jobApplications.$inferInsert;
