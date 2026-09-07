import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The module deletes user data. What is under test is therefore exactly WHAT
// it deletes: the windows (copied from /privacy §6), the boundary of each
// window, the statement each policy issues, how the run batches, and how it
// behaves when a table fails. The database is a spy that records every
// statement and answers with whatever count the case needs.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute } }));

import {
  cutoffDay,
  cutoffFor,
  DAY_MS,
  deleteBatchSql,
  expiredWhere,
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES_PER_TABLE,
  RETENTION_POLICIES,
  runRetention,
} from "./retention";

const NOW = new Date("2026-09-07T12:34:56.789Z");

/** Render a statement the way the driver would see it: text + bound params. */
function render(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

/** postgres-js reports affected rows on the result list's `count`. */
function rows(count: number) {
  return Object.assign([] as unknown[], { count });
}

function policy(name: string) {
  const found = RETENTION_POLICIES.find((p) => p.name === name);
  if (!found) throw new Error(`no policy for ${name}`);
  return found;
}

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("retention policies — the promises of /privacy §6, pinned", () => {
  it("covers exactly the four ledgers, with the windows the policy states", () => {
    // A change here is a change to what viewers were told. Deliberate ones
    // come with a /privacy edit and a data-map row; accidental ones fail here.
    expect(
      RETENTION_POLICIES.map((p) => [p.name, p.column.name, p.grain, p.window]),
    ).toEqual([
      ["trial_sessions", "started_at", "instant", { days: 30 }],
      ["visitors", "first_seen_at", "instant", { months: 25 }],
      ["watch_days", "day", "day", { months: 25 }],
      ["show_reminders", "notified_at", "instant", { days: 30 }],
    ]);
  });

  it("cites §6 for every window", () => {
    for (const p of RETENTION_POLICIES) expect(p.promise).toMatch(/^§6 /);
  });

  it("never names the tables that live with the account, the Stripe ledger or the aggregates", () => {
    const names = RETENTION_POLICIES.map((p) => p.name);
    for (const forbidden of [
      "users",
      "subscriptions",
      "watch_progress",
      "stripe_events",
      "watch_segments",
      "erased_customers",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe("cutoffFor — where the window ends", () => {
  it("counts days as exact multiples of 24h from now", () => {
    expect(cutoffFor({ days: 30 }, NOW).getTime()).toBe(NOW.getTime() - 30 * DAY_MS);
  });

  it("counts months on the calendar, keeping the time of day", () => {
    expect(cutoffFor({ months: 25 }, NOW).toISOString()).toBe(
      "2024-08-07T12:34:56.789Z",
    );
  });

  it("clamps to the last day of the target month instead of rolling over", () => {
    // 31 May − 25 months → 30 April, not "31 April" (= 1 May, a LATER cutoff
    // that would keep rows past the promised span).
    expect(
      cutoffFor({ months: 25 }, new Date("2026-05-31T00:00:00.000Z")).toISOString(),
    ).toBe("2024-04-30T00:00:00.000Z");
    // Leap year: 31 March 2026 − 25 months lands in February 2024, which has 29.
    expect(
      cutoffFor({ months: 25 }, new Date("2026-03-31T23:59:59.000Z")).toISOString(),
    ).toBe("2024-02-29T23:59:59.000Z");
    // Non-leap: February 2023 has 28.
    expect(
      cutoffFor({ months: 25 }, new Date("2025-03-31T06:00:00.000Z")).toISOString(),
    ).toBe("2023-02-28T06:00:00.000Z");
  });

  it("crosses a year boundary going backwards", () => {
    expect(
      cutoffFor({ months: 25 }, new Date("2026-01-15T00:00:00.000Z")).toISOString(),
    ).toBe("2023-12-15T00:00:00.000Z");
  });

  it("expresses a DATE-column boundary as the cutoff's UTC calendar day", () => {
    expect(cutoffDay(new Date("2024-08-07T23:59:59.999Z"))).toBe("2024-08-07");
    expect(cutoffDay(new Date("2024-08-08T00:00:00.000Z"))).toBe("2024-08-08");
  });
});

describe("expiredWhere — which rows a policy selects", () => {
  it("trial_sessions: anonymous rows started before now − 30 days, strictly", () => {
    const q = render(expiredWhere(policy("trial_sessions"), NOW));
    expect(q.sql).toBe(
      '("trial_sessions"."started_at" < $1 and "trial_sessions"."user_id" is null)',
    );
    // Strict `<`: a row started exactly at the cutoff is one the window still
    // covers. The bound value IS the cutoff, so the boundary is the same one
    // cutoffFor was tested on.
    expect(q.params).toEqual([new Date(NOW.getTime() - 30 * DAY_MS).toISOString()]);
  });

  it("visitors: identifiers first seen before now − 25 months (visitor_days follow by cascade)", () => {
    const q = render(expiredWhere(policy("visitors"), NOW));
    expect(q.sql).toBe('"visitors"."first_seen_at" < $1');
    expect(q.params).toEqual(["2024-08-07T12:34:56.789Z"]);
  });

  it("watch_days: days before the cutoff's calendar day — the cutoff day itself is kept", () => {
    const q = render(expiredWhere(policy("watch_days"), NOW));
    expect(q.sql).toBe('"watch_days"."day" < $1');
    // A DATE column compares against a day string; the day containing the
    // cutoff instant may hold activity from after it, so it is not expired.
    expect(q.params).toEqual(["2024-08-07"]);
  });

  it("show_reminders: only rows that were actually sent, and sent before now − 30 days", () => {
    const q = render(expiredWhere(policy("show_reminders"), NOW));
    expect(q.sql).toBe(
      '("show_reminders"."notified_at" < $1 and "show_reminders"."notified_at" is not null)',
    );
    expect(q.params).toEqual([new Date(NOW.getTime() - 30 * DAY_MS).toISOString()]);
  });
});

describe("deleteBatchSql — the shape of one batch", () => {
  it("deletes by primary key from a LIMITed subselect over the same predicate", () => {
    const q = render(deleteBatchSql(policy("trial_sessions"), NOW, 1000));
    expect(q.sql).toBe(
      'DELETE FROM "trial_sessions" WHERE "trial_sessions"."id" IN ' +
        '(SELECT "trial_sessions"."id" FROM "trial_sessions" WHERE ' +
        '("trial_sessions"."started_at" < $1 and "trial_sessions"."user_id" is null) LIMIT $2)',
    );
    expect(q.params[1]).toBe(1000);
  });

  it("uses the composite key for the ledger without a single-column id", () => {
    const q = render(deleteBatchSql(policy("watch_days"), NOW, 500));
    expect(q.sql).toBe(
      'DELETE FROM "watch_days" WHERE ("watch_days"."user_id", "watch_days"."day") IN ' +
        '(SELECT ("watch_days"."user_id", "watch_days"."day") FROM "watch_days" WHERE ' +
        '"watch_days"."day" < $1 LIMIT $2)',
    );
    expect(q.params).toEqual(["2024-08-07", 500]);
  });
});

describe("runRetention — batching, isolation, reporting", () => {
  /** The table each recorded statement targets, in order. */
  const targets = () =>
    execute.mock.calls.map((call) => {
      const q = render(call[0] as SQL);
      return /^DELETE FROM "([a-z_]+)"/.exec(q.sql)?.[1];
    });

  it("keeps deleting a table while batches come back full, then moves on", async () => {
    execute
      .mockResolvedValueOnce(rows(1000))
      .mockResolvedValueOnce(rows(1000))
      .mockResolvedValueOnce(rows(4))
      .mockResolvedValue(rows(0));

    const result = await runRetention({ now: NOW });

    // Three batches for the first table (two full, one short), one empty
    // batch for each of the other three.
    expect(targets()).toEqual([
      "trial_sessions",
      "trial_sessions",
      "trial_sessions",
      "visitors",
      "watch_days",
      "show_reminders",
    ]);
    expect(result.deleted).toEqual({
      trial_sessions: 2004,
      visitors: 0,
      watch_days: 0,
      show_reminders: 0,
    });
    expect(result.failed).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("issues every batch with the configured size and the same `now`", async () => {
    execute.mockResolvedValue(rows(0));

    await runRetention({ now: NOW, batchSize: 250 });

    for (const call of execute.mock.calls) {
      const q = render(call[0] as SQL);
      expect(q.params.at(-1)).toBe(250);
    }
    expect(RETENTION_BATCH_SIZE).toBe(1000);
  });

  it("stops a table at the batch cap and reports the run as truncated", async () => {
    // A backlog that never ends: every batch is full.
    execute.mockResolvedValue(rows(1000));

    const result = await runRetention({ now: NOW, maxBatchesPerTable: 3 });

    expect(targets().filter((t) => t === "trial_sessions")).toHaveLength(3);
    expect(result.deleted.trial_sessions).toBe(3000);
    expect(result.truncated).toBe(true);
    // The cap is a per-table ceiling, not a run-wide one: the other tables
    // still got their turn.
    expect(targets()).toContain("show_reminders");
    expect(RETENTION_MAX_BATCHES_PER_TABLE).toBe(50);
  });

  it("stops when the time budget is spent instead of running into the platform's limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // Each batch "takes" 30 seconds of wall clock.
    execute.mockImplementation(async () => {
      vi.advanceTimersByTime(30_000);
      return rows(1000);
    });

    const result = await runRetention({ now: NOW, budgetMs: 40_000 });

    // Batch 1 at t=0 (ok), batch 2 at t=30s (ok, 30 ≤ 40), then t=60s > 40s:
    // stop — and no further table is started either.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.deleted.trial_sessions).toBe(2000);
    expect(result.truncated).toBe(true);
    expect(result.durationMs).toBe(60_000);
  });

  it("names a failing table and still runs the others", async () => {
    execute.mockImplementation(async (query: SQL) => {
      if (render(query).sql.startsWith('DELETE FROM "visitors"')) {
        throw new Error("deadlock detected");
      }
      return rows(0);
    });

    const result = await runRetention({ now: NOW });

    expect(result.failed).toEqual(["visitors"]);
    expect(targets()).toEqual([
      "trial_sessions",
      "visitors",
      "watch_days",
      "show_reminders",
    ]);
    // What is logged is the table and a counter — never the error, whose
    // text is the driver's and may quote the statement (log audit).
    expect(console.error).toHaveBeenCalledWith("retention: table failed", {
      table: "visitors",
      deletedBeforeFailure: 0,
    });
  });

  it("treats a result without a count as zero rows, not as a full batch", async () => {
    // A driver answer with no `count` must end the loop, or a mocked or
    // odd result would loop until the cap.
    execute.mockResolvedValue([]);

    const result = await runRetention({ now: NOW });

    expect(execute).toHaveBeenCalledTimes(RETENTION_POLICIES.length);
    expect(result.truncated).toBe(false);
  });

  it("logs the run as counters only", async () => {
    execute.mockResolvedValue(rows(0));

    await runRetention({ now: NOW });

    expect(console.info).toHaveBeenCalledWith("retention: run complete", {
      deleted: { trial_sessions: 0, visitors: 0, watch_days: 0, show_reminders: 0 },
      failed: [],
      truncated: false,
      durationMs: expect.any(Number),
    });
  });
});
