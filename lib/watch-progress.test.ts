import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The shared progress write — one implementation under the web's server
// action and the app's POST /api/v1/progress. What is under test is the
// SHAPE of the write it issues: which row it keys on, what it floors, what
// it refuses, and the SQL it carries for the monotonic playhead. The
// database is faked down to the two builders the module walks.
const h = vi.hoisted(() => ({
  row: undefined as
    | { id: string; showId: string; access: string; durationSeconds?: number | null }
    | undefined,
  inserts: [] as Array<{ table: unknown; values: unknown; conflict: unknown }>,
  hasActiveSubscription: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => (h.row ? [h.row] : []) }),
          }),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const call = { table, values, conflict: null as unknown };
        h.inserts.push(call);
        return {
          onConflictDoUpdate: async (conflict: unknown) => {
            call.conflict = conflict;
          },
          onConflictDoNothing: async () => {
            call.conflict = "do_nothing";
          },
        };
      },
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  episodes: { id: "episodes.id", status: "episodes.status", access: "episodes.access" },
  seasons: { id: "seasons.id", showId: "seasons.show_id" },
  shows: { id: "shows.id", status: "shows.status", deletedAt: "shows.deleted_at" },
  watchProgress: {
    userId: "watch_progress.user_id",
    episodeId: "watch_progress.episode_id",
    maxPositionSeconds: "watch_progress.max_position_seconds",
  },
  watchDays: { table: "watch_days" },
}));
vi.mock("drizzle-orm", () => ({
  and: () => undefined,
  eq: () => undefined,
  isNull: () => undefined,
  // Renders the tagged template to plain text so a test can read the SQL a
  // write carries — the GREATEST() IS the monotonic contract.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.raw.reduce(
      (acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""),
      "",
    ),
}));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: h.hasActiveSubscription,
}));

import { watchDays, watchProgress } from "@/db/schema";
import {
  POSITION_SECONDS_MAX,
  clampPositionSeconds,
  saveWatchProgressForUser,
} from "./watch-progress";

const USER = "user_1";
const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

type Upsert = {
  values: Record<string, unknown>;
  conflict: { target: unknown[]; set: Record<string, unknown> };
};

function progressWrites(): Upsert[] {
  return h.inserts.filter((c) => c.table === watchProgress) as Upsert[];
}

beforeEach(() => {
  h.row = { id: EPISODE, showId: "show-1", access: "free" };
  h.inserts = [];
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  vi.stubEnv("PAYMENTS_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("clampPositionSeconds", () => {
  it("floors a fractional playhead to whole seconds", () => {
    expect(clampPositionSeconds(12.7)).toBe(12);
    expect(clampPositionSeconds(0)).toBe(0);
    expect(clampPositionSeconds(POSITION_SECONDS_MAX)).toBe(POSITION_SECONDS_MAX);
  });

  it("rejects anything that is not a finite second count within a day", () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, POSITION_SECONDS_MAX + 1, "12", null, undefined]) {
      expect(clampPositionSeconds(bad)).toBeNull();
    }
  });
});

describe("saveWatchProgressForUser — refusals write nothing", () => {
  it("rejects an out-of-range position before touching the database", async () => {
    await expect(saveWatchProgressForUser(USER, EPISODE, -5, false)).resolves.toBe(
      "invalid_position",
    );
    expect(h.inserts).toEqual([]);
  });

  it("reports a missing, draft or unpublished episode as not found", async () => {
    // The lookup carries the ready/published/not-deleted filter, so an empty
    // result IS that refusal.
    h.row = undefined;
    await expect(saveWatchProgressForUser(USER, EPISODE, 10, false)).resolves.toBe(
      "not_found",
    );
    expect(h.inserts).toEqual([]);
  });
});

describe("saveWatchProgressForUser — the write", () => {
  it("upserts on the natural (user, episode) key with the floored position", async () => {
    await expect(saveWatchProgressForUser(USER, EPISODE, 12.7, false)).resolves.toBe(
      "saved",
    );

    const [write] = progressWrites();
    expect(write.values).toEqual({
      userId: USER,
      episodeId: EPISODE,
      positionSeconds: 12,
      maxPositionSeconds: 12,
      completed: false,
    });
    // This target is what makes a retry safe: a second identical request
    // lands on the same row instead of creating another.
    expect(write.conflict.target).toEqual([watchProgress.userId, watchProgress.episodeId]);
    expect(write.conflict.set.positionSeconds).toBe(12);
    expect(write.conflict.set.updatedAt).toBeInstanceOf(Date);
  });

  it("touches exactly four columns on conflict — never first_watched_at or total_watched_seconds", async () => {
    // first_watched_at feeds the dashboard's release retention and
    // total_watched_seconds is owned by saveWatchSegments; a save that
    // rewrote either would silently corrupt both. Pin the whole key set.
    await saveWatchProgressForUser(USER, EPISODE, 12, false);

    const [write] = progressWrites();
    expect(Object.keys(write.conflict.set).sort()).toEqual([
      "completed",
      "maxPositionSeconds",
      "positionSeconds",
      "updatedAt",
    ]);
  });

  it("caps the position at the episode's own duration", async () => {
    // A client could otherwise post a day against a ten-minute episode and
    // "finish" it for the dashboard (finished = max_position ≥ 95 %·duration)
    // — and knock it off the continue-watching rail.
    h.row = { id: EPISODE, showId: "show-1", access: "free", durationSeconds: 600 };
    await expect(saveWatchProgressForUser(USER, EPISODE, 86_400, false)).resolves.toBe(
      "saved",
    );

    const [write] = progressWrites();
    expect(write.values).toMatchObject({ positionSeconds: 600, maxPositionSeconds: 600 });
    expect(write.conflict.set.positionSeconds).toBe(600);
    expect(write.conflict.set.maxPositionSeconds).toBe(
      `GREATEST(${watchProgress.maxPositionSeconds}, 600)`,
    );
  });

  it("keeps the 24h ceiling alone when the duration is unknown", async () => {
    h.row = { id: EPISODE, showId: "show-1", access: "free", durationSeconds: null };
    await saveWatchProgressForUser(USER, EPISODE, 5000, false);
    expect(progressWrites()[0].values).toMatchObject({ positionSeconds: 5000 });
  });

  it("keeps max_position_seconds monotonic on a seek back", async () => {
    await saveWatchProgressForUser(USER, EPISODE, 100, false);
    await saveWatchProgressForUser(USER, EPISODE, 40, false);

    const [, seekBack] = progressWrites();
    // The resume target follows the playhead down…
    expect(seekBack.conflict.set.positionSeconds).toBe(40);
    // …but the depth marker only ever compares up: GREATEST(existing, new),
    // never the bare new value.
    expect(seekBack.conflict.set.maxPositionSeconds).toBe(
      `GREATEST(${watchProgress.maxPositionSeconds}, 40)`,
    );
  });

  it("lets `completed` flip both ways — the rail reads it live", async () => {
    await saveWatchProgressForUser(USER, EPISODE, 500, true);
    await saveWatchProgressForUser(USER, EPISODE, 20, false);

    const [finished, rewatch] = progressWrites();
    expect(finished.conflict.set.completed).toBe(true);
    expect(rewatch.conflict.set.completed).toBe(false);
  });

  it("stamps the user's day in the activity ledger on the same tick, in UTC", async () => {
    // Late evening UTC: a local-date rendering would already read the 2nd
    // in Europe. The dashboard buckets days in UTC, so the ledger must too.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T23:30:00Z"));

    await saveWatchProgressForUser(USER, EPISODE, 10, false);

    const ledger = h.inserts.find((c) => c.table === watchDays);
    expect(ledger).toBeDefined();
    expect(ledger?.values).toEqual({ userId: USER, day: "2026-09-01" });
    // A no-op on the second save of the day, never a duplicate-key error.
    expect(ledger?.conflict).toBe("do_nothing");
  });

  it("never consults the subscription in free mode", async () => {
    h.row = { id: EPISODE, showId: "show-1", access: "subscriber" };
    await expect(saveWatchProgressForUser(USER, EPISODE, 10, false)).resolves.toBe(
      "saved",
    );
    expect(h.hasActiveSubscription).not.toHaveBeenCalled();
  });
});

describe("saveWatchProgressForUser — paid-mode ownership gate", () => {
  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
  });

  it("refuses a non-subscriber on a subscriber-tier episode, writing nothing", async () => {
    h.row = { id: EPISODE, showId: "show-1", access: "subscriber" };
    await expect(saveWatchProgressForUser(USER, EPISODE, 10, false)).resolves.toBe(
      "forbidden",
    );
    expect(h.inserts).toEqual([]);
  });

  it("lets a non-subscriber save on an episode open to them", async () => {
    h.row = { id: EPISODE, showId: "show-1", access: "member" };
    await expect(saveWatchProgressForUser(USER, EPISODE, 10, false)).resolves.toBe(
      "saved",
    );
    expect(progressWrites()).toHaveLength(1);
  });

  it("lets a subscriber save on anything", async () => {
    h.hasActiveSubscription.mockResolvedValue(true);
    h.row = { id: EPISODE, showId: "show-1", access: "subscriber" };
    await expect(saveWatchProgressForUser(USER, EPISODE, 10, false)).resolves.toBe(
      "saved",
    );
    expect(h.hasActiveSubscription).toHaveBeenCalledWith(USER);
  });
});
