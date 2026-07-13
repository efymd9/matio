import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { shows } from "./shows";
import { users } from "./users";

// Email capture for "next episode coming" reminders. Written from the
// SeriesEndOverlay (components/watch/series-end-overlay.tsx) when a
// viewer finishes the last episode of a show and asks to be notified.
//
// Dispatched via Resend from the admin "notify waiting viewers" panel
// (app/admin/reminder-actions.ts): the send action claims batches by
// stamping `notified_at = now()` before dispatching and reverts the
// stamp on a failed batch — `notified_at IS NULL` always means
// "still owed an email". Unsubscribing (lib/email-unsubscribe.ts)
// hard-deletes every row for the email address.
//
// userId is nullable so non-subscribers and trial users can sign up
// too. The (show_id, email) unique constraint dedupes repeat submits;
// the conflict path re-arms notified_at (see subscribeToShowReminder).
export const showReminders = pgTable(
  "show_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    // Linked to the user when the request comes from a signed-in
    // session; nullable because anonymous viewers can also leave their
    // email. ON DELETE SET NULL so account deletion doesn't erase the
    // reminder request — the email itself is the address.
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Site locale at capture time — the reminder email is rendered in
    // this language. Rows predating the column (form was hidden then,
    // so realistically none) default to the site-default English.
    locale: text("locale").notNull().default("en"),
    // HMAC'd client IP (same hashClientIp as trial_sessions — never raw
    // IPs) for the capture rate limit: the submit action counts rows
    // created per (ip_hash, last hour) and rejects past the cap, so an
    // anonymous attacker can't flood the ledger with garbage addresses
    // that the admin send would then blast through Resend. Nullable —
    // rows predating the column.
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Set when the reminder email actually goes out. Until then this
    // row is a pending intent; the dispatch job queries WHERE
    // notified_at IS NULL.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    unique("show_reminders_show_id_email_unique").on(t.showId, t.email),
    // FK index — PG doesn't auto-index FKs and the cascade-delete from
    // shows would do a sequential scan without it.
    index("show_reminders_show_id_idx").on(t.showId),
    // Hot path for the future dispatch job: "give me all pending
    // reminders for this show". Partial index keeps it tiny — sent
    // rows fall out of the predicate.
    index("show_reminders_show_id_pending_idx")
      .on(t.showId, t.createdAt)
      .where(sql`notified_at IS NULL`),
    // Capture rate limit scan: rows created per (ip_hash, last hour).
    index("show_reminders_ip_hash_created_idx").on(t.ipHash, t.createdAt),
  ],
);

export type ShowReminder = typeof showReminders.$inferSelect;
export type NewShowReminder = typeof showReminders.$inferInsert;
