import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The app's retention flush, end to end through the REAL shared write
// (lib/watch-segments-write.ts) down to a faked database. What a shipped
// binary depends on: who may flush (Bearer, device id, the positional gate),
// the status codes, and that the row underneath keys on its natural
// (episode, day, bucket) so a retried flush never creates a second one.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  episode: undefined as
    | { id: string; showId: string; access: string; durationSeconds: number | null }
    | undefined,
  // Existing trial_sessions rows as (token, show) pairs; the fake answers the
  // lookup by matching the eq() clauses the write sends — see the lib suite.
  sessions: [] as Array<{ token: string; showId: string }>,
  inserts: [] as Array<{ table: unknown; values: unknown; conflict: unknown }>,
  updates: [] as Array<{ table: unknown; set: unknown }>,
  updateError: null as Error | null,
  hasActiveSubscription: vi.fn(),
  orderedEpisodeIds: vi.fn(),
}));

type EqClause = { column: unknown; value: unknown };

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const isTrial = (table as { table?: string } | null)?.table === "trial_sessions";
        const episodeLimit = async () => (h.episode ? [h.episode] : []);
        return {
          where: (clause: unknown) => ({
            limit: async () => {
              if (!isTrial) return episodeLimit();
              const eqs = clause as EqClause[];
              const token = eqs.find((e) => e.column === "trial_sessions.session_token")?.value;
              const showId = eqs.find((e) => e.column === "trial_sessions.show_id")?.value;
              return h.sessions.some((s) => s.token === token && s.showId === showId)
                ? [{ id: "sess-1" }]
                : [];
            },
          }),
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
  episodes: {},
  seasons: {},
  shows: {},
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
  and: (...clauses: unknown[]) => clauses,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: () => undefined,
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

import { DEVICE_ID_HEADER } from "@/lib/api/v1";
import { watchProgress, watchSegments } from "@/db/schema";
import { POST } from "./route";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const EPISODE_2 = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const DEVICE = "9c858901-8a57-4791-81fe-4c455b099bc9";
const SHOW = "show-1";

function post(
  body: unknown,
  opts: { device?: string | null } = {},
): Parameters<typeof POST>[0] {
  const headers = new Headers();
  const device = opts.device === undefined ? DEVICE : opts.device;
  if (device) headers.set(DEVICE_ID_HEADER, device);
  return {
    headers,
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

type SegmentUpsert = {
  values: Array<{ episodeId: string; day: string; bucket: number; views: number }>;
  conflict: { target: unknown[]; set: Record<string, unknown> };
};

function segmentWrites(): SegmentUpsert[] {
  return h.inserts.filter((c) => c.table === watchSegments) as SegmentUpsert[];
}

beforeEach(() => {
  h.userId = null;
  h.episode = { id: EPISODE, showId: SHOW, access: "free", durationSeconds: 600 };
  h.sessions = [{ token: DEVICE, showId: SHOW }];
  h.inserts = [];
  h.updates = [];
  h.updateError = null;
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  h.orderedEpisodeIds.mockReset().mockResolvedValue([EPISODE, EPISODE_2]);
  vi.stubEnv("PAYMENTS_ENABLED", "");
  vi.stubEnv("REQUIRE_SIGNUP", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/watch-segments — input", () => {
  it("rejects a malformed body with 400 and writes nothing", async () => {
    const bodies = [
      null,
      {},
      { episodeId: "nope", buckets: [1] },
      { episodeId: EPISODE },
      { episodeId: EPISODE, buckets: [] },
      { episodeId: EPISODE, buckets: "1,2" },
      { episodeId: EPISODE, buckets: [1.5] },
      { episodeId: EPISODE, buckets: [-1] },
      { episodeId: EPISODE, buckets: ["1"] },
      { episodeId: EPISODE, buckets: Array.from({ length: 121 }, (_, i) => i) },
    ];
    for (const body of bodies) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
    expect(h.inserts).toEqual([]);
  });

  it("is 404 for an episode that is not ready or whose show is unpublished", async () => {
    h.episode = undefined;
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));
    expect(res.status).toBe(404);
    expect(h.inserts).toEqual([]);
  });

  it("keeps the answer out of caches", async () => {
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/v1/watch-segments — identity", () => {
  it("is 401 with neither a session nor a device id, and reads nothing", async () => {
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }, { device: null }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(h.inserts).toEqual([]);
  });

  it("treats a malformed device id as absent — garbage never becomes a session key", async () => {
    for (const bad of ["not-a-uuid", "'; drop table users;--", "12345"]) {
      const res = await POST(post({ episodeId: EPISODE, buckets: [1] }, { device: bad }));
      expect(res.status, bad).toBe(401);
    }
    expect(h.inserts).toEqual([]);
  });

  it("counts for a device that holds a session row for the show", async () => {
    const res = await POST(post({ episodeId: EPISODE, buckets: [1, 2] }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, accepted: 2 });
    expect(segmentWrites()).toHaveLength(1);
    // Anonymous: no progress row to credit.
    expect(h.updates).toEqual([]);
  });

  it("is 403 for a device with no playback session on the show", async () => {
    h.sessions = [];
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));
    expect(res.status).toBe(403);
    // Not a wall the client can route to — no reason field.
    expect((await res.json()).error).not.toHaveProperty("reason");
    expect(h.inserts).toEqual([]);
  });

  it("is 403 for a device whose session row is on a DIFFERENT show — the row is per (token, show)", async () => {
    // The device started show B; that proves nothing about show A, whose
    // shared counters must not move on it.
    h.sessions = [{ token: DEVICE, showId: "show-B" }];
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));
    expect(res.status).toBe(403);
    expect(h.inserts).toEqual([]);
  });

  it("prefers the Bearer session over the device id and credits the progress row", async () => {
    h.userId = "user_1";
    h.sessions = []; // would refuse an anonymous caller
    const res = await POST(post({ episodeId: EPISODE, buckets: [1, 2, 3] }));

    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].table).toBe(watchProgress);
    expect(h.updates[0].set).toEqual({
      totalWatchedSeconds: `${watchProgress.totalWatchedSeconds} + 30`,
    });
  });

  it("answers 200 with accepted when the credit fails after the counter landed — a retry would inflate views", async () => {
    h.userId = "user_1";
    h.updateError = new Error("connection reset");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(post({ episodeId: EPISODE, buckets: [1, 2, 3] }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, accepted: 3 });
    expect(segmentWrites()).toHaveLength(1);
  });
});

describe("POST /api/v1/watch-segments — the signup gate", () => {
  beforeEach(() => {
    vi.stubEnv("REQUIRE_SIGNUP", "1");
  });

  it("lets an anonymous device count on episode 1 under after_episodes: 1", async () => {
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));
    expect(res.status).toBe(200);
    expect(segmentWrites()).toHaveLength(1);
  });

  it("refuses episode 2 with signup_required even though the device has a session row", async () => {
    h.episode = { id: EPISODE_2, showId: SHOW, access: "free", durationSeconds: 600 };
    const res = await POST(post({ episodeId: EPISODE_2, buckets: [1] }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("signup_required");
    expect(h.inserts).toEqual([]);
  });

  it("follows APP_SIGNUP_GATE_EPISODES — the same lever the token route enforces", async () => {
    vi.stubEnv("APP_SIGNUP_GATE_EPISODES", "2");
    h.episode = { id: EPISODE_2, showId: SHOW, access: "free", durationSeconds: 600 };
    const res = await POST(post({ episodeId: EPISODE_2, buckets: [1] }));
    expect(res.status).toBe(200);
  });

  it("does not gate a signed-in viewer", async () => {
    h.userId = "user_1";
    h.episode = { id: EPISODE_2, showId: SHOW, access: "free", durationSeconds: 600 };
    const res = await POST(post({ episodeId: EPISODE_2, buckets: [1] }));
    expect(res.status).toBe(200);
    expect(h.orderedEpisodeIds).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/watch-segments — paid mode", () => {
  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
  });

  it("keeps anonymous previews off the retention curve, with no reason to route on", async () => {
    // The token route may have answered 200 (trial) or subscribe_required
    // for the very same episode; a flush refusal must not contradict it.
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).not.toHaveProperty("reason");
    expect(h.inserts).toEqual([]);
  });

  it("answers subscribe_required for a non-subscriber on a subscriber-tier episode", async () => {
    h.userId = "user_1";
    h.episode = { id: EPISODE, showId: SHOW, access: "subscriber", durationSeconds: 600 };
    const res = await POST(post({ episodeId: EPISODE, buckets: [1] }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("subscribe_required");
    expect(h.inserts).toEqual([]);
  });
});

describe("POST /api/v1/watch-segments — the row underneath", () => {
  it("is idempotent: a repeated flush is the same upsert on the same (episode, day, bucket)", async () => {
    const body = { episodeId: EPISODE, buckets: [4, 5] };
    await POST(post(body));
    await POST(post(body));

    const writes = segmentWrites();
    expect(writes).toHaveLength(2);
    const today = new Date().toISOString().slice(0, 10);
    for (const write of writes) {
      expect(write.values).toEqual([
        { episodeId: EPISODE, day: today, bucket: 4, views: 1 },
        { episodeId: EPISODE, day: today, bucket: 5, views: 1 },
      ]);
      expect(write.conflict.target).toEqual([
        watchSegments.episodeId,
        watchSegments.day,
        watchSegments.bucket,
      ]);
      expect(write.conflict.set.views).toBe(`${watchSegments.views} + 1`);
    }
    // Never a second row of the other kind either: the credit is UPDATE-only.
    expect(h.inserts.filter((c) => c.table === watchProgress)).toEqual([]);
  });

  it("reports how many buckets survived the episode's timeline bound", async () => {
    // 600s → buckets 0..60; 61 and a duplicate are dropped, not rejected.
    const res = await POST(post({ episodeId: EPISODE, buckets: [60, 60, 61] }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, accepted: 1 });
  });
});
