import { eq, inArray, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  showReminders,
  subscriptions,
  trialSessions,
  users,
  visitorDays,
  visitors,
  watchDays,
  watchProgress,
} from "@/db/schema";
import type { UserExportRows } from "@/lib/user-export";

// The database half of the art. 15/20 export: every table that can be tied
// to a person, read by the key that ties it (the list in the data map,
// .claude/skills/gdpr/references/data-map.md §2):
//
//   users            id
//   subscriptions    user_id
//   watch_progress   user_id
//   watch_days       user_id
//   trial_sessions   user_id  (SET NULL on erasure — anonymous rows are not
//                              the subject's by any key we hold)
//   visitors         user_id  → visitor_days by the visitors found (aid)
//   show_reminders   user_id OR email — the two can disagree: the row is
//                    keyed by address, user_id is a coalesce-backfill
//
// Not here on purpose: watch_segments (an aggregate without a user key),
// stripe_events (raw webhook ids), guest_checkout_attempts (ip_hash only,
// self-pruned in 2h), marketing_links (an admin's id).
//
// `db` is a parameter rather than the module singleton so the script hands
// in the client it opened AFTER checking DATABASE_URL, and the tests hand in
// a recorder — no raw SQL, every clause is a Drizzle expression a test can
// render and read.

export type ExportDb = Pick<PostgresJsDatabase<typeof schema>, "select">;

export async function loadUserExportRows(
  db: ExportDb,
  userId: string,
): Promise<UserExportRows> {
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  const email = userRows[0]?.email;

  const subscriptionRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));
  const progressRows = await db
    .select()
    .from(watchProgress)
    .where(eq(watchProgress.userId, userId));
  const dayRows = await db
    .select()
    .from(watchDays)
    .where(eq(watchDays.userId, userId));
  const trialRows = await db
    .select()
    .from(trialSessions)
    .where(eq(trialSessions.userId, userId));
  const visitorRows = await db
    .select()
    .from(visitors)
    .where(eq(visitors.userId, userId));

  const aids = visitorRows.map((v) => v.aid);
  const visitorDayRows =
    aids.length > 0
      ? await db.select().from(visitorDays).where(inArray(visitorDays.aid, aids))
      : [];

  const reminderRows = await db
    .select()
    .from(showReminders)
    .where(
      email
        ? or(eq(showReminders.userId, userId), eq(showReminders.email, email))
        : eq(showReminders.userId, userId),
    );

  return {
    users: userRows,
    subscriptions: subscriptionRows,
    watch_progress: progressRows,
    watch_days: dayRows,
    trial_sessions: trialRows,
    visitors: visitorRows,
    visitor_days: visitorDayRows,
    show_reminders: reminderRows,
  };
}
