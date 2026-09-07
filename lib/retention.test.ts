import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The module deletes user data. What is under test is therefore exactly WHAT
// it deletes: the windows (copied from /privacy §6), the boundary of each
// window, the statement each policy issues, how the run batches, and how it
// behaves when a table fails. The database is a spy that records every
// statement and answers with whatever count the case needs.
const { execute, captureMessage } = vi.hoisted(() => ({
  execute: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { execute } }));
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

import {
  cutoffDay,
  cutoffFor,
  DAY_MS,
  deleteBatchSql,
  describeDbError,
  expiredWhere,
  policyOrder,
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES_PER_TABLE,
  RETENTION_POLICIES,
  runRetention,
} from "./retention";

const NOW = new Date("2026-09-07T12:34:56.789Z");

// A day whose rotation offset is 0, so the runner visits the policies in
// their declared order (see policyOrder) and the expectations below read
// top to bottom. Asserted rather than assumed, at the top of the runner suite.
const RUN_AT = new Date("2026-09-04T12:00:00.000Z");

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

/** What the driver throws through Drizzle 0.44+: the PostgresError sits on `.cause`. */
function driverError(code: string, message = "deadlock detected") {
  const cause = Object.assign(new Error(message), { name: "PostgresError", code });
  return Object.assign(new Error(`Failed query: ${message}`), {
    name: "DrizzleQueryError",
    cause,
  });
}

beforeEach(() => {
  execute.mockReset();
  captureMessage.mockReset();
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

  it("compares a composite key as a row constructor against a BARE column list", () => {
    // `(a, b) IN (SELECT (a, b) …)` is not the same statement: the
    // parenthesised projection is ONE record-typed column and Postgres
    // rejects it at parse time ("subquery has too few columns") — which the
    // runner's catch would then hide as a nightly 500 (PR #186 review).
    const q = render(deleteBatchSql(policy("watch_days"), NOW, 500));
    expect(q.sql).toBe(
      'DELETE FROM "watch_days" WHERE ("watch_days"."user_id", "watch_days"."day") IN ' +
        '(SELECT "watch_days"."user_id", "watch_days"."day" FROM "watch_days" WHERE ' +
        '"watch_days"."day" < $1 LIMIT $2)',
    );
    expect(q.params).toEqual(["2024-08-07", 500]);
  });

  it("projects a bare column list in the subselect of EVERY policy — never a wrapped one", () => {
    for (const p of RETENTION_POLICIES) {
      const { sql } = render(deleteBatchSql(p, NOW, 10));
      const projection = /\bIN \(SELECT (.+?) FROM "/.exec(sql)?.[1];
      expect(projection, p.name).toBeDefined();
      // Not wrapped: the first character is the opening quote of a column,
      // and the list has exactly as many entries as the key has columns.
      expect(projection, p.name).toMatch(/^"/);
      expect(projection, p.name).not.toMatch(/^\(/);
      const expected = p.keyColumns
        .map((c) => `"${p.name}"."${c.name}"`)
        .join(", ");
      expect(projection, p.name).toBe(expected);
      // The left-hand side wraps the same list only when it is composite.
      const left = p.keyColumns.length > 1 ? `(${expected})` : expected;
      expect(sql, p.name).toContain(`DELETE FROM "${p.name}" WHERE ${left} IN (SELECT`);
    }
  });
});

describe("describeDbError — what a failure may be described by", () => {
  it("reads the SQLSTATE through Drizzle's wrapper and reports the thrown error's class", () => {
    expect(describeDbError(driverError("40P01"))).toEqual({
      name: "DrizzleQueryError",
      code: "40P01",
    });
  });

  it("reads a bare driver error too", () => {
    const bare = Object.assign(new Error("relation does not exist"), {
      name: "PostgresError",
      code: "42P01",
    });
    expect(describeDbError(bare)).toEqual({ name: "PostgresError", code: "42P01" });
  });

  it("answers with no code when there is none, and survives a non-Error throw", () => {
    expect(describeDbError(new TypeError("boom"))).toEqual({ name: "TypeError", code: null });
    expect(describeDbError("string thrown")).toEqual({ name: "string", code: null });
    expect(describeDbError(undefined)).toEqual({ name: "undefined", code: null });
  });
});

describe("policyOrder — daily rotation of the starting table", () => {
  const names = (at: Date) => policyOrder(at).map((p) => p.name);

  it("starts from the declared order on a day with offset 0 and shifts by one each day", () => {
    expect(Math.floor(RUN_AT.getTime() / DAY_MS) % RETENTION_POLICIES.length).toBe(0);
    expect(names(RUN_AT)).toEqual([
      "trial_sessions",
      "visitors",
      "watch_days",
      "show_reminders",
    ]);
    expect(names(new Date(RUN_AT.getTime() + DAY_MS))).toEqual([
      "visitors",
      "watch_days",
      "show_reminders",
      "trial_sessions",
    ]);
    // Every table is first once per cycle — a backlog cannot starve the
    // tables behind it night after night.
    expect(names(new Date(RUN_AT.getTime() + 4 * DAY_MS))).toEqual(names(RUN_AT));
  });

  it("is a permutation, never a subset", () => {
    for (let d = 0; d < 4; d++) {
      const at = new Date(RUN_AT.getTime() + d * DAY_MS);
      expect([...names(at)].sort()).toEqual(
        RETENTION_POLICIES.map((p) => p.name).sort(),
      );
    }
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

    const result = await runRetention({ now: RUN_AT });

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
    expect(result.truncated).toEqual({});
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("visits the tables in the day's rotated order", async () => {
    execute.mockResolvedValue(rows(0));

    await runRetention({ now: new Date(RUN_AT.getTime() + DAY_MS) });

    expect(targets()).toEqual([
      "visitors",
      "watch_days",
      "show_reminders",
      "trial_sessions",
    ]);
  });

  it("issues every batch with the configured size and the same `now`", async () => {
    execute.mockResolvedValue(rows(0));

    await runRetention({ now: RUN_AT, batchSize: 250 });

    for (const call of execute.mock.calls) {
      const q = render(call[0] as SQL);
      expect(q.params.at(-1)).toBe(250);
    }
    expect(RETENTION_BATCH_SIZE).toBe(1000);
  });

  it("stops a table at the batch cap and names it as truncated", async () => {
    // A backlog that never ends: every batch is full.
    execute.mockResolvedValue(rows(1000));

    const result = await runRetention({ now: RUN_AT, maxBatchesPerTable: 3 });

    for (const table of ["trial_sessions", "visitors", "watch_days", "show_reminders"]) {
      expect(targets().filter((t) => t === table)).toHaveLength(3);
    }
    expect(result.deleted.trial_sessions).toBe(3000);
    // The cap is a per-table ceiling, not a run-wide one: every table got
    // its turn, and every table is reported as still having a backlog.
    expect(result.truncated).toEqual({
      trial_sessions: true,
      visitors: true,
      watch_days: true,
      show_reminders: true,
    });
    expect(RETENTION_MAX_BATCHES_PER_TABLE).toBe(50);
  });

  it("stops when the time budget is spent and names every table it did not finish", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(RUN_AT);
    // Each batch "takes" 30 seconds of wall clock.
    execute.mockImplementation(async () => {
      vi.advanceTimersByTime(30_000);
      return rows(1000);
    });

    const result = await runRetention({ now: RUN_AT, budgetMs: 40_000 });

    // Batch 1 at t=0 (ok), batch 2 at t=30s (ok, 30 ≤ 40), then t=60s > 40s:
    // stop. The tables behind it never start — and say so, one by one, so
    // the log can tell "cut short mid-table" from "never reached".
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.deleted.trial_sessions).toBe(2000);
    expect(result.truncated).toEqual({
      trial_sessions: true,
      visitors: true,
      watch_days: true,
      show_reminders: true,
    });
    expect(result.durationMs).toBe(60_000);
  });

  it("names a failing table, still runs the others, and reports code + class — never the message", async () => {
    execute.mockImplementation(async (query: SQL) => {
      if (render(query).sql.startsWith('DELETE FROM "visitors"')) {
        throw driverError("40P01", "deadlock detected while locking row 'someone@example.invalid'");
      }
      return rows(0);
    });

    const result = await runRetention({ now: RUN_AT });

    expect(result.failed).toEqual(["visitors"]);
    expect(targets()).toEqual([
      "trial_sessions",
      "visitors",
      "watch_days",
      "show_reminders",
    ]);
    // What is logged: the table, the SQLSTATE, the error class and a counter
    // — enough to tell a deadlock from a missing table from a timeout, and
    // nothing the driver quoted (the statement, the row).
    expect(console.error).toHaveBeenCalledWith("retention: table failed", {
      table: "visitors",
      code: "40P01",
      name: "DrizzleQueryError",
      deletedBeforeFailure: 0,
    });
    // The same three facts reach Sentry as a MESSAGE with tags — not the
    // exception, whose text is the driver's.
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith("retention: table failed", {
      level: "error",
      tags: { table: "visitors", code: "40P01", name: "DrizzleQueryError" },
    });
    expect(JSON.stringify(captureMessage.mock.calls[0])).not.toContain("example.invalid");
  });

  it("tags a failure without a SQLSTATE as `none` rather than dropping the tag", async () => {
    execute.mockRejectedValue(new TypeError("fetch failed"));

    const result = await runRetention({ now: RUN_AT });

    expect(result.failed).toHaveLength(4);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({
      tags: { table: "trial_sessions", code: "none", name: "TypeError" },
    });
  });

  it("treats a result without a count as zero rows, not as a full batch", async () => {
    // A driver answer with no `count` must end the loop, or a mocked or
    // odd result would loop until the cap.
    execute.mockResolvedValue([]);

    const result = await runRetention({ now: RUN_AT });

    expect(execute).toHaveBeenCalledTimes(RETENTION_POLICIES.length);
    expect(result.truncated).toEqual({});
  });

  it("logs the run as counters only", async () => {
    execute.mockResolvedValue(rows(0));

    await runRetention({ now: RUN_AT });

    expect(console.info).toHaveBeenCalledWith("retention: run complete", {
      deleted: { trial_sessions: 0, visitors: 0, watch_days: 0, show_reminders: 0 },
      failed: [],
      truncated: {},
      durationMs: expect.any(Number),
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
