import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { showReminders, trialSessions, visitors, watchDays } from "@/db/schema";

// Data retention — the code behind /privacy §6 "How long we keep it".
//
// Until #162 the policy promised windows (30 days for trial sessions, 25
// months for audience measurement) and nothing in the codebase enforced them:
// every ledger grew forever. This module is the enforcement. It is deliberately
// two halves:
//
//   1. the POLICIES — pure data: which table, which column, which window, and
//      the sentence of /privacy the window is copied from. The window is the
//      legal promise, not an engineering guess: where the two disagree the
//      promise wins, because it is what a viewer was told.
//   2. the RUNNER — batched, idempotent DELETEs driven by the policies, called
//      once a day by Vercel Cron through /api/cron/retention.
//
// What it never touches, by design: `users`, `subscriptions`, `watch_progress`
// ("while your account exists" — they live and die with the account through
// the Clerk `user.deleted` cascade), `stripe_events` (an idempotency ledger of
// event ids — no personal data; its growth is a separate, non-privacy
// decision) and `watch_segments` (aggregate counters per episode/day/bucket —
// nothing about a person to expire). Backups have their own 35-day retention
// in `infra/backup/`.
//
// Idempotency / concurrency, in one sentence: the predicate is "older than the
// cutoff", a row deleted once is simply gone, and two overlapping runs that
// pick the same keys have the second DELETE find nothing (READ COMMITTED skips
// rows a committed transaction already removed) — no table locks, no state.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Rows per DELETE statement. Small enough to hold row locks for milliseconds, not seconds. */
export const RETENTION_BATCH_SIZE = 1000;

/**
 * Batches per table per run — a ceiling on one invocation's work (50k rows a
 * table a day). A backlog bigger than that is drained over consecutive days;
 * the run reports the table under `truncated` so the log shows it is still
 * catching up.
 */
export const RETENTION_MAX_BATCHES_PER_TABLE = 50;

/**
 * Wall-clock budget for one run. Serverless functions have a hard duration
 * limit (the route declares 60s); stopping ourselves at 40s turns "the
 * platform killed us mid-statement" into "we stopped and said so".
 */
export const RETENTION_TIME_BUDGET_MS = 40_000;

export type RetentionWindow = { days: number } | { months: number };

export type RetentionTable =
  | "trial_sessions"
  | "visitors"
  | "watch_days"
  | "show_reminders";

export interface RetentionPolicy {
  /** Real table name — what the log line and the response name. */
  name: RetentionTable;
  table: PgTable;
  /**
   * The primary key the batched DELETE selects on. One column, or the
   * columns of a composite key — the statement builder renders them as a
   * row constructor on the DELETE side and as a bare column list in the
   * subselect (`(a, b) IN (SELECT a, b …)`); a parenthesised list in the
   * SELECT would be ONE record-typed column and Postgres rejects it at parse
   * time ("subquery has too few columns").
   */
  keyColumns: readonly PgColumn[];
  /** The column the window is measured against. Must be indexed — see db/schema. */
  column: PgColumn;
  /**
   * `instant` compares the column against the cutoff moment; `day` is for
   * DATE columns and compares against the cutoff's UTC calendar day, so a
   * day equal to the cutoff day (which may hold rows from after the cutoff
   * instant) is kept.
   */
  grain: "instant" | "day";
  window: RetentionWindow;
  /** Narrows the population; combined with AND. */
  extra?: SQL;
  /** The /privacy §6 wording the window is copied from. */
  promise: string;
}

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    name: "trial_sessions",
    table: trialSessions,
    keyColumns: [trialSessions.id],
    column: trialSessions.startedAt,
    grain: "instant",
    window: { days: 30 },
    // Anonymous rows only. A row linked to an account is the account's own
    // data ("Account: while your account exists"); on erasure the link is
    // SET NULL and the row falls under this policy on the next run — that is
    // the "short grace period after deletion" §6 mentions. The app's device
    // rows (session_token = device UUID) are anonymous rows like any other.
    extra: isNull(trialSessions.userId),
    promise:
      "§6 Trial sessions: retained for 30 days for abuse analytics, then deleted or fully anonymised",
  },
  {
    name: "visitors",
    table: visitors,
    keyColumns: [visitors.aid],
    column: visitors.firstSeenAt,
    grain: "instant",
    window: { months: 25 },
    // `visitor_days` goes with it: FK ON DELETE CASCADE, and a day cannot
    // precede the identifier's first_seen_at, so nothing is left behind.
    // The cascade can reach a day younger than 25 months, though: the
    // `matio_aid` cookie lives 395 days and is never refreshed
    // (VISITOR_COOKIE_MAX_AGE), so an identifier first seen 25 months ago
    // may still hold days up to ~12 months old. 25 months is at least 758
    // days; 758 − 395 = 363 — the youngest day this can remove sits just
    // under the dashboard's 366-day maximum range, so a year-long custom
    // range can lose a day or two at its far edge. Accepted: the window is
    // §6's promise, not the dashboard's wish.
    promise:
      "§6 Audience-measurement data: the first-party audience identifier and the data recorded against it are kept for up to 25 months",
  },
  {
    name: "watch_days",
    table: watchDays,
    keyColumns: [watchDays.userId, watchDays.day],
    column: watchDays.day,
    grain: "day",
    window: { months: 25 },
    // The signed-in half of the same measurement (rolling WAU, new /
    // returning / lost) — the same window as the anonymous half. The longest
    // dashboard range is a year (lib/admin-analytics-v2.ts clamps custom
    // ranges to 366 days), well inside it — this table is keyed by day, so
    // unlike `visitors` nothing younger than the window ever goes.
    promise:
      "§6 Audience-measurement data … up to 25 months (watch activity per day is the signed-in audience measurement)",
  },
  {
    name: "show_reminders",
    table: showReminders,
    keyColumns: [showReminders.id],
    column: showReminders.notifiedAt,
    grain: "instant",
    window: { days: 30 },
    // Sent rows only. `notified_at IS NULL` means "still owed an email" and
    // is never expired here — a request that has not been fulfilled is not
    // stale. A sent row's job is done; resubmitting after the window simply
    // inserts a fresh request. 30 days is the shortest window §6 uses and
    // matches Resend's own 30-day delivery log, so a bounce or complaint can
    // still be reconciled with its row.
    extra: isNotNull(showReminders.notifiedAt),
    promise:
      "§6 uses 30 days as its shortest window (trial sessions; request and security logs) — the reminder request itself is not named there yet",
  },
];

/** The moment before which a row is older than the window. */
export function cutoffFor(window: RetentionWindow, now: Date): Date {
  if ("days" in window) return new Date(now.getTime() - window.days * DAY_MS);
  // Calendar months, in UTC, clamped to the target month's last day: 31 May
  // minus 25 months is 30 April, never "31 April" rolled over into May. The
  // clamp errs towards an EARLIER cutoff, i.e. never keeps a row past the
  // promised span.
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - window.months,
      1,
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
      now.getUTCMilliseconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return target;
}

/** UTC calendar day of an instant, in the `YYYY-MM-DD` form DATE columns compare against. */
export function cutoffDay(cutoff: Date): string {
  return cutoff.toISOString().slice(0, 10);
}

/** The WHERE that selects a policy's expired rows at `now`. Strict `<`: a row exactly at the cutoff is kept. */
export function expiredWhere(policy: RetentionPolicy, now: Date): SQL {
  const cutoff = cutoffFor(policy.window, now);
  const boundary = policy.grain === "day" ? cutoffDay(cutoff) : cutoff;
  const older = lt(policy.column, boundary);
  return (policy.extra ? and(older, policy.extra) : undefined) ?? older;
}

/** The key as the DELETE compares it: a bare column, or a row constructor for a composite key. */
export function comparisonKey(policy: RetentionPolicy): SQL {
  const list = sql.join([...policy.keyColumns], sql`, `);
  return policy.keyColumns.length === 1 ? list : sql`(${list})`;
}

/** The key as the subselect projects it: always a bare column list — never wrapped, see `keyColumns`. */
export function projectionKey(policy: RetentionPolicy): SQL {
  return sql.join([...policy.keyColumns], sql`, `);
}

/**
 * One batched DELETE. `key IN (SELECT key … LIMIT n)` is the portable way to
 * bound a DELETE in Postgres (DELETE has no LIMIT of its own); the subselect
 * walks the column's index and touches at most `batchSize` rows.
 */
export function deleteBatchSql(
  policy: RetentionPolicy,
  now: Date,
  batchSize: number,
): SQL {
  return sql`DELETE FROM ${policy.table} WHERE ${comparisonKey(policy)} IN (SELECT ${projectionKey(policy)} FROM ${policy.table} WHERE ${expiredWhere(policy, now)} LIMIT ${batchSize})`;
}

/**
 * The order tables are visited on a given day. Rotates daily so a table with
 * a backlog that eats the whole time budget cannot starve the ones behind it
 * night after night — each table is first once every four days.
 */
export function policyOrder(now: Date): readonly RetentionPolicy[] {
  const n = RETENTION_POLICIES.length;
  const start = Math.floor(now.getTime() / DAY_MS) % n;
  return RETENTION_POLICIES.map((_, i) => RETENTION_POLICIES[(start + i) % n]);
}

/**
 * What can be said about a failed statement without quoting it: the error's
 * class and the driver's SQLSTATE (42P01 undefined_table, 40P01 deadlock,
 * 57014 query_canceled, …). Drizzle 0.44+ wraps the PostgresError in a
 * DrizzleQueryError with the original on `.cause` — walked the same way as
 * lib/db-errors.ts. The message is deliberately NOT read: the driver quotes
 * the statement in it, and a constraint error can quote the row.
 */
export function describeDbError(e: unknown): { name: string; code: string | null } {
  const name = e instanceof Error ? e.name : typeof e;
  for (let err = e, depth = 0; err && depth < 5; depth++) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return { name, code };
    err = (err as { cause?: unknown }).cause;
  }
  return { name, code: null };
}

export interface RetentionRunResult {
  /** Rows deleted per table in this run (cascaded `visitor_days` are not counted separately). */
  deleted: Record<RetentionTable, number>;
  /** Tables whose statement failed; the rest of the run still happened. */
  failed: RetentionTable[];
  /**
   * Tables the run left with expired rows still in place — a batch cap, the
   * time budget, or the budget running out before the table's turn. The next
   * run continues; a table that keeps appearing here has a backlog the daily
   * ceiling cannot drain.
   */
  truncated: Partial<Record<RetentionTable, true>>;
  durationMs: number;
}

export interface RetentionRunOptions {
  now?: Date;
  batchSize?: number;
  maxBatchesPerTable?: number;
  budgetMs?: number;
}

/**
 * Run every policy once. Never throws: a failing table is named in `failed`
 * and the others still get their turn, because one broken statement must not
 * leave every other ledger growing.
 *
 * Logs COUNTERS, TABLE NAMES AND ERROR CODES ONLY — never a caught error's
 * text. The driver quotes the statement and can quote the row it choked on,
 * and this is a path the log audit (lib/log-audit.test.ts) seeds with user
 * text for exactly that reason. Failures also go to Sentry as a message with
 * the same three tags: Vercel's runtime log lives a day, and "the retention
 * cron has been red for a week" must be visible somewhere that keeps it.
 */
export async function runRetention(
  options: RetentionRunOptions = {},
): Promise<RetentionRunResult> {
  const {
    now = new Date(),
    batchSize = RETENTION_BATCH_SIZE,
    maxBatchesPerTable = RETENTION_MAX_BATCHES_PER_TABLE,
    budgetMs = RETENTION_TIME_BUDGET_MS,
  } = options;
  const startedAt = Date.now();
  const deleted = {
    trial_sessions: 0,
    visitors: 0,
    watch_days: 0,
    show_reminders: 0,
  } satisfies Record<RetentionTable, number>;
  const failed: RetentionTable[] = [];
  const truncated: Partial<Record<RetentionTable, true>> = {};

  for (const policy of policyOrder(now)) {
    try {
      for (let batch = 0; ; batch++) {
        if (batch >= maxBatchesPerTable || Date.now() - startedAt > budgetMs) {
          truncated[policy.name] = true;
          break;
        }
        const result = await db.execute(deleteBatchSql(policy, now, batchSize));
        // postgres-js reports affected rows on the result list's `count`.
        const removed = (result as { count?: number }).count ?? 0;
        deleted[policy.name] += removed;
        if (removed < batchSize) break;
      }
    } catch (err) {
      failed.push(policy.name);
      const { name, code } = describeDbError(err);
      const report = {
        table: policy.name,
        code,
        name,
        deletedBeforeFailure: deleted[policy.name],
      };
      console.error("retention: table failed", report);
      Sentry.captureMessage("retention: table failed", {
        level: "error",
        tags: { table: policy.name, code: code ?? "none", name },
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  console.info("retention: run complete", { deleted, failed, truncated, durationMs });
  return { deleted, failed, truncated, durationMs };
}
