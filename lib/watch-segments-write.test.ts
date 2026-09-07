import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The shared retention-counter write — one implementation under the web's
// saveWatchSegments action and the app's POST /api/v1/watch-segments. Under
// test is the SHAPE of what it issues: which row it keys on, what it drops,
// who it refuses, and the SQL the increment carries. The database is faked
// down to the builders the module walks.
const h = vi.hoisted(() => ({
  episode: undefined as
    | { id: string; showId: string; access: string; durationSeconds: number | null }
    | undefined,
  // The trial_sessions rows that exist: (token, show) pairs. The fake
  // answers the lookup by matching the eq() clauses the write actually
  // sends, so a query keyed on the wrong show finds nothing — that is the
  // invariant under test, not a convenience.
  sessions: [] as Array<{ token: string; showId: string }>,
  trialWhere: [] as unknown[],
  inserts: [] as Array<{ table: unknown; values: unknown; conflict: unknown }>,
  updates: [] as Array<{ table: unknown; set: unknown }>,
  updateError: null as Error | null,
  hasActiveSubscription: vi.fn(),
  orderedEpisodeIds: vi.fn(),
}));

type EqClause = { column: unknown; value: unknown };

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const isTrial = (table as { table?: string } | null)?.table === "trial_sessions";
        const episodeLimit = async () => (h.episode ? [h.episode] : []);
        return {
          // trial_sessions: from().where(and(eq(token), eq(show))).limit()
          where: (clause: unknown) => ({
            limit: async () => {
              if (!isTrial) return episodeLimit();
              h.trialWhere.push(clause);
              const eqs = clause as EqClause[];
              const token = eqs.find((e) => e.column === "trial_sessions.session_token")?.value;
              const showId = eqs.find((e) => e.column === "trial_sessions.show_id")?.value;
              return h.sessions.some((s) => s.token === token && s.showId === showId)
                ? [{ id: "sess-1" }]
                : [];
            },
          }),
          // episodes ⋈ seasons ⋈ shows: from().innerJoin().innerJoin().where().limit()
          innerJoin: () => ({
            innerJoin: () => ({ where: () => ({ limit: episodeLimit }) }),
          }),
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        const call = { table, values, conflict: null as unknown };
        h.inserts.push(call);
        return {
          onConflictDoUpdate: async (conflict: unknown) => {
            call.conflict = conflict;
          },
        };
      },
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => {
        h.updates.push({ table, set });
        return {
          where: async () => {
            if (h.updateError) throw h.updateError;
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
  trialSessions: {
    table: "trial_sessions",
    id: "trial_sessions.id",
    sessionToken: "trial_sessions.session_token",
    showId: "trial_sessions.show_id",
  },
  watchProgress: {
    table: "watch_progress",
    userId: "watch_progress.user_id",
    episodeId: "watch_progress.episode_id",
    totalWatchedSeconds: "watch_progress.total_watched_seconds",
  },
  watchSegments: {
    table: "watch_segments",
    episodeId: "watch_segments.episode_id",
    day: "watch_segments.day",
    bucket: "watch_segments.bucket",
    views: "watch_segments.views",
  },
}));
vi.mock("drizzle-orm", () => ({
  // and()/eq() keep their arguments so the trial_sessions fake can see WHICH
  // (token, show) the write asked for.
  and: (...clauses: unknown[]) => clauses,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: () => undefined,
  // Renders the tagged template to plain text so a test can read the SQL a
  // write carries — the `views + 1` IS the counter contract.
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.raw.reduce(
      (acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""),
      "",
    ),
}));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: h.hasActiveSubscription,
}));
vi.mock("@/lib/episode-access", () => ({
  getOrderedReadyEpisodeIds: h.orderedEpisodeIds,
}));

import { watchProgress, watchSegments } from "@/db/schema";
import { saveWatchSegmentsFor, type SegmentsCaller } from "./watch-segments-write";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EPISODE_2 = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const DEVICE = "9c858901-8a57-4791-81fe-4c455b099bc9";
const SHOW = "show-1";

const user: SegmentsCaller = { kind: "user", userId: "user_1" };
const anonymousOpen: SegmentsCaller = {
  kind: "anonymous",
  sessionToken: DEVICE,
  maxPosition: null,
};

type SegmentUpsert = {
  values: Array<{ episodeId: string; day: string; bucket: number; views: number }>;
  conflict: { target: unknown[]; set: Record<string, unknown> };
};

function segmentWrites(): SegmentUpsert[] {
  return h.inserts.filter((c) => c.table === watchSegments) as SegmentUpsert[];
}

beforeEach(() => {
  h.episode = { id: EPISODE, showId: SHOW, access: "free", durationSeconds: 600 };
  h.sessions = [{ token: DEVICE, showId: SHOW }];
  h.trialWhere = [];
  h.inserts = [];
  h.updates = [];
  h.updateError = null;
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  h.orderedEpisodeIds.mockReset().mockResolvedValue([EPISODE, EPISODE_2]);
  vi.stubEnv("PAYMENTS_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("saveWatchSegmentsFor — input", () => {
  it("refuses a malformed episode id before touching the database", async () => {
    for (const bad of ["", "nope", "'; drop table users;--"]) {
      await expect(saveWatchSegmentsFor(user, bad, [1])).resolves.toEqual({
        outcome: "invalid_input",
      });
    }
    expect(h.inserts).toEqual([]);
  });

  it("refuses an empty flush and one over the per-flush cap", async () => {
    await expect(saveWatchSegmentsFor(user, EPISODE, [])).resolves.toEqual({
      outcome: "invalid_input",
    });
    const tooMany = Array.from({ length: 121 }, (_, i) => i);
    await expect(saveWatchSegmentsFor(user, EPISODE, tooMany)).resolves.toEqual({
      outcome: "invalid_input",
    });
    expect(h.inserts).toEqual([]);
  });

  it("is not_found for an episode that is not ready or whose show is unpublished", async () => {
    h.episode = undefined;
    await expect(saveWatchSegmentsFor(user, EPISODE, [1])).resolves.toEqual({
      outcome: "not_found",
    });
    expect(h.inserts).toEqual([]);
  });
});

describe("saveWatchSegmentsFor — the counter row", () => {
  it("keys every bucket on (episode, UTC day, bucket) and increments views", async () => {
    const result = await saveWatchSegmentsFor(user, EPISODE, [3, 4, 5]);

    expect(result).toEqual({ outcome: "saved", accepted: 3 });
    const [write] = segmentWrites();
    const today = new Date().toISOString().slice(0, 10);
    expect(write.values).toEqual([
      { episodeId: EPISODE, day: today, bucket: 3, views: 1 },
      { episodeId: EPISODE, day: today, bucket: 4, views: 1 },
      { episodeId: EPISODE, day: today, bucket: 5, views: 1 },
    ]);
    expect(write.conflict.target).toEqual([
      watchSegments.episodeId,
      watchSegments.day,
      watchSegments.bucket,
    ]);
    expect(write.conflict.set.views).toBe(`${watchSegments.views} + 1`);
  });

  it("is idempotent on the row: a repeated flush is the same upsert on the same key", async () => {
    await saveWatchSegmentsFor(user, EPISODE, [7]);
    await saveWatchSegmentsFor(user, EPISODE, [7]);

    const writes = segmentWrites();
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.values.map((v) => v.bucket)).toEqual([7]);
      expect(write.conflict.target).toEqual([
        watchSegments.episodeId,
        watchSegments.day,
        watchSegments.bucket,
      ]);
    }
  });

  it("dedupes within a flush and drops buckets past the episode's timeline", async () => {
    // 600s → buckets 0..60. 61 is past the end; 1.5 and -1 are not buckets.
    const result = await saveWatchSegmentsFor(user, EPISODE, [2, 2, 60, 61, 1.5, -1]);

    expect(result).toEqual({ outcome: "saved", accepted: 2 });
    expect(segmentWrites()[0].values.map((v) => v.bucket)).toEqual([2, 60]);
  });

  it("answers accepted: 0 without writing when nothing survives the bound", async () => {
    const result = await saveWatchSegmentsFor(user, EPISODE, [999]);
    expect(result).toEqual({ outcome: "saved", accepted: 0 });
    expect(h.inserts).toEqual([]);
    expect(h.updates).toEqual([]);
  });

  it("falls back to the 24h ceiling when the episode's duration is unknown", async () => {
    h.episode = { id: EPISODE, showId: SHOW, access: "free", durationSeconds: null };
    const result = await saveWatchSegmentsFor(user, EPISODE, [8640, 8641]);
    expect(result).toEqual({ outcome: "saved", accepted: 1 });
  });
});

describe("saveWatchSegmentsFor — signed-in credit", () => {
  it("credits watched seconds on the progress row with an UPDATE, never an insert", async () => {
    await saveWatchSegmentsFor(user, EPISODE, [1, 2, 3]);

    // No placeholder progress row: that would surface a ghost tile in the
    // continue-watching rail.
    expect(h.inserts.filter((c) => c.table === watchProgress)).toEqual([]);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe(watchProgress);
    expect(h.updates[0].set).toEqual({
      totalWatchedSeconds: `${watchProgress.totalWatchedSeconds} + 30`,
    });
  });

  it("gates a non-subscriber off a subscriber-tier episode in paid mode", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.episode = { id: EPISODE, showId: SHOW, access: "subscriber", durationSeconds: 600 };

    await expect(saveWatchSegmentsFor(user, EPISODE, [1])).resolves.toEqual({
      outcome: "forbidden",
    });
    expect(h.inserts).toEqual([]);

    h.hasActiveSubscription.mockResolvedValue(true);
    await expect(saveWatchSegmentsFor(user, EPISODE, [1])).resolves.toEqual({
      outcome: "saved",
      accepted: 1,
    });
  });

  it("skips the subscription lookup entirely while payments are off", async () => {
    h.episode = { id: EPISODE, showId: SHOW, access: "subscriber", durationSeconds: 600 };
    await saveWatchSegmentsFor(user, EPISODE, [1]);
    expect(h.hasActiveSubscription).not.toHaveBeenCalled();
    expect(segmentWrites()).toHaveLength(1);
  });

  it("still reports saved when the credit fails after the counter landed, logging ids only", async () => {
    // The two writes are not one transaction. A failure here must NOT read
    // as a failed flush: the caller would retry, and every landed retry is
    // another +1 on views. The driver's message quotes the statement —
    // none of it may reach the console.
    const quoted = "update watch_progress set total_watched_seconds = ... where user_id = 'user_1' — leak.marker@example.invalid";
    h.updateError = new Error(quoted);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await saveWatchSegmentsFor(user, EPISODE, [1, 2, 3]);

    expect(result).toEqual({ outcome: "saved", accepted: 3 });
    expect(segmentWrites()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain(EPISODE);
    expect(line).toContain("user_1");
    expect(line).not.toContain("leak.marker");
    expect(line).not.toContain("update watch_progress");
  });
});

describe("saveWatchSegmentsFor — anonymous callers", () => {
  it("counts for a device that holds a session row for the show, and credits no progress", async () => {
    const result = await saveWatchSegmentsFor(anonymousOpen, EPISODE, [1, 2]);

    expect(result).toEqual({ outcome: "saved", accepted: 2 });
    expect(segmentWrites()).toHaveLength(1);
    expect(h.updates).toEqual([]);
  });

  it("looks the session row up by (token, THIS episode's show) — never by token alone", async () => {
    await saveWatchSegmentsFor(anonymousOpen, EPISODE, [1]);

    expect(h.trialWhere).toEqual([
      [
        { column: "trial_sessions.session_token", value: DEVICE },
        { column: "trial_sessions.show_id", value: SHOW },
      ],
    ]);
  });

  it("refuses a device whose only session row is on ANOTHER show", async () => {
    // A row on show B proves the device started show B, nothing about show A —
    // the shared counters of A must not move on it.
    h.sessions = [{ token: DEVICE, showId: "show-B" }];
    await expect(saveWatchSegmentsFor(anonymousOpen, EPISODE, [1])).resolves.toEqual({
      outcome: "no_session",
    });
    expect(h.inserts).toEqual([]);
  });

  it("refuses a token with no session row at all — presence alone must not move shared counters", async () => {
    h.sessions = [];
    await expect(saveWatchSegmentsFor(anonymousOpen, EPISODE, [1])).resolves.toEqual({
      outcome: "no_session",
    });
    expect(h.inserts).toEqual([]);
  });

  it("enforces the positional gate: episode N+1 is forbidden even with a session row", async () => {
    const gated: SegmentsCaller = { kind: "anonymous", sessionToken: DEVICE, maxPosition: 1 };
    h.episode = { id: EPISODE_2, showId: SHOW, access: "free", durationSeconds: 600 };

    await expect(saveWatchSegmentsFor(gated, EPISODE_2, [1])).resolves.toEqual({
      outcome: "forbidden",
    });
    expect(h.inserts).toEqual([]);
  });

  it("lets episode N through the positional gate", async () => {
    const gated: SegmentsCaller = { kind: "anonymous", sessionToken: DEVICE, maxPosition: 1 };
    await expect(saveWatchSegmentsFor(gated, EPISODE, [1])).resolves.toEqual({
      outcome: "saved",
      accepted: 1,
    });
  });

  it("forbids an episode missing from the show's ready ordering under a gate", async () => {
    const gated: SegmentsCaller = { kind: "anonymous", sessionToken: DEVICE, maxPosition: 5 };
    h.orderedEpisodeIds.mockResolvedValue([EPISODE_2]);
    await expect(saveWatchSegmentsFor(gated, EPISODE, [1])).resolves.toEqual({
      outcome: "forbidden",
    });
  });

  it("does not consult the ordering when there is no gate", async () => {
    await saveWatchSegmentsFor(anonymousOpen, EPISODE, [1]);
    expect(h.orderedEpisodeIds).not.toHaveBeenCalled();
  });
});
