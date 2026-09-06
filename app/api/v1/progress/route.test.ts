import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The app's progress save, end to end through the REAL shared write
// (lib/watch-progress.ts) down to a faked database. What a shipped binary
// depends on: the status codes, and that the write underneath keys on the
// natural (user, episode) row — so a retried or replayed save can never
// create a second one.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  row: undefined as { id: string; showId: string; access: string } | undefined,
  inserts: [] as Array<{ table: unknown; values: unknown; conflict: unknown }>,
  hasActiveSubscription: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
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
  episodes: {},
  seasons: {},
  shows: {},
  watchProgress: {
    table: "watch_progress",
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.raw.reduce(
      (acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ""),
      "",
    ),
}));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: h.hasActiveSubscription,
}));

import { watchProgress } from "@/db/schema";
import { POST } from "./route";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function post(body: unknown): Parameters<typeof POST>[0] {
  return {
    headers: new Headers(),
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

type Upsert = {
  values: Record<string, unknown>;
  conflict: { target: unknown[]; set: Record<string, unknown> };
};

function progressWrites(): Upsert[] {
  return h.inserts.filter((c) => c.table === watchProgress) as Upsert[];
}

beforeEach(() => {
  h.userId = "user_1";
  h.row = { id: EPISODE, showId: "show-1", access: "free" };
  h.inserts = [];
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  vi.stubEnv("PAYMENTS_ENABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/progress — who may save", () => {
  it("is 401 for an anonymous caller, and writes nothing", async () => {
    h.userId = null;
    const res = await POST(post({ episodeId: EPISODE, positionSeconds: 10, completed: false }));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(h.inserts).toEqual([]);
  });

  it("keeps the answer out of caches", async () => {
    const res = await POST(post({ episodeId: EPISODE, positionSeconds: 10, completed: false }));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /api/v1/progress — input", () => {
  it("rejects a malformed body without writing", async () => {
    const bodies = [
      null,
      {},
      { episodeId: "nope", positionSeconds: 10, completed: false },
      { episodeId: EPISODE, positionSeconds: "10", completed: false },
      { episodeId: EPISODE, positionSeconds: 10, completed: "yes" },
      { episodeId: EPISODE, positionSeconds: 10 },
    ];
    for (const body of bodies) {
      const res = await POST(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(h.inserts).toEqual([]);
  });

  it("rejects an out-of-range position with 400 (negative, NaN, a day and more)", async () => {
    for (const positionSeconds of [-1, Number.NaN, 24 * 60 * 60 + 1]) {
      const res = await POST(post({ episodeId: EPISODE, positionSeconds, completed: false }));
      expect(res.status).toBe(400);
    }
    expect(h.inserts).toEqual([]);
  });

  it("floors a fractional playhead to whole seconds", async () => {
    const res = await POST(post({ episodeId: EPISODE, positionSeconds: 12.7, completed: false }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    const [write] = progressWrites();
    expect(write.values).toMatchObject({ userId: "user_1", episodeId: EPISODE, positionSeconds: 12 });
  });

  it("is 404 for an episode that is not ready or whose show is unpublished", async () => {
    h.row = undefined;
    const res = await POST(post({ episodeId: EPISODE, positionSeconds: 10, completed: false }));
    expect(res.status).toBe(404);
    expect(h.inserts).toEqual([]);
  });
});

describe("POST /api/v1/progress — the row underneath", () => {
  it("is idempotent: a repeated request is the same upsert on the same key", async () => {
    const body = { episodeId: EPISODE, positionSeconds: 30, completed: false };
    await POST(post(body));
    await POST(post(body));

    const writes = progressWrites();
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.conflict.target).toEqual([watchProgress.userId, watchProgress.episodeId]);
      expect(write.values).toMatchObject({ userId: "user_1", episodeId: EPISODE, positionSeconds: 30 });
    }
  });

  it("keeps max_position_seconds monotonic when the viewer seeks back", async () => {
    await POST(post({ episodeId: EPISODE, positionSeconds: 100, completed: false }));
    await POST(post({ episodeId: EPISODE, positionSeconds: 40, completed: false }));

    const [, seekBack] = progressWrites();
    expect(seekBack.conflict.set.positionSeconds).toBe(40);
    expect(seekBack.conflict.set.maxPositionSeconds).toBe(
      `GREATEST(${watchProgress.maxPositionSeconds}, 40)`,
    );
  });

  it("records `completed` as sent — true at the end, false again on a rewatch", async () => {
    await POST(post({ episodeId: EPISODE, positionSeconds: 590, completed: true }));
    await POST(post({ episodeId: EPISODE, positionSeconds: 5, completed: false }));

    const [ended, rewatch] = progressWrites();
    expect(ended.conflict.set.completed).toBe(true);
    expect(rewatch.conflict.set.completed).toBe(false);
  });

  it("answers `subscribe_required` for a non-subscriber on a paid-tier episode", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.row = { id: EPISODE, showId: "show-1", access: "subscriber" };

    const res = await POST(post({ episodeId: EPISODE, positionSeconds: 10, completed: false }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("subscribe_required");
    expect(h.inserts).toEqual([]);
  });
});
