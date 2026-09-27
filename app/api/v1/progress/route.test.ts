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
  // The `users` mirror rows that exist. The fake enforces the foreign key
  // watch_progress and watch_days hold on it, the way Postgres does: a write
  // for a user without a row fails with 23503, wrapped by Drizzle on `.cause`.
  users: new Set<string>(),
  // What Clerk answers for the signed-in user — the heal's source of truth.
  clerkUser: vi.fn(),
  // Stored resume rows for GET, keyed "<user>/<episode>".
  progress: new Map<string, { positionSeconds: number }>(),
  // A one-off failure for the next watch_progress write (a non-FK error).
  failNextWrite: null as Error | null,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
  currentUser: () => h.clerkUser(),
}));
vi.mock("@/db", () => {
  // Drizzle's DrizzleQueryError: `.code` is not on the thrown error itself,
  // the PostgresError sits on `.cause`.
  const fkViolation = () =>
    Object.assign(new Error("Failed query: insert into watch_progress …"), {
      cause: Object.assign(new Error("violates foreign key constraint"), { code: "23503" }),
    });
  // Only the table and the equality filters matter to the fake: eq() below
  // returns its operands, and() the list of them.
  const rowsFor = (table: { table?: string }, filters: unknown[]) => {
    const value = (column: string) =>
      (filters.find((f) => Array.isArray(f) && f[0] === column) as unknown[] | undefined)?.[1];
    if (table.table === "users") {
      const id = value("users.id") as string;
      return h.users.has(id) ? [{ id, email: "viewer@example.invalid" }] : [];
    }
    if (table.table === "watch_progress") {
      const row = h.progress.get(
        `${value("watch_progress.user_id")}/${value("watch_progress.episode_id")}`,
      );
      return row ? [row] : [];
    }
    // The save's episode lookup (episodes ⋈ seasons ⋈ shows).
    return h.row ? [h.row] : [];
  };
  return {
    db: {
      select: () => ({
        from: (table: { table?: string }) => {
          let filters: unknown[] = [];
          const chain = {
            innerJoin: () => chain,
            where: (filter: unknown) => {
              filters = Array.isArray(filter) && Array.isArray(filter[0]) ? filter : [filter];
              return chain;
            },
            limit: async () => rowsFor(table, filters),
          };
          return chain;
        },
      }),
      insert: (table: { table?: string }) => ({
        values: (values: { userId?: string; id?: string }) => {
          const call = { table, values, conflict: null as unknown };
          const write = () => {
            if (table.table === "users") {
              h.users.add(values.id!);
            } else if (table.table === "watch_progress" && h.failNextWrite) {
              const err = h.failNextWrite;
              h.failNextWrite = null;
              throw err;
            } else if (!h.users.has(values.userId!)) {
              throw fkViolation();
            }
            h.inserts.push(call);
          };
          return {
            onConflictDoUpdate: async (conflict: unknown) => {
              call.conflict = conflict;
              write();
            },
            onConflictDoNothing: async () => {
              call.conflict = "do_nothing";
              write();
            },
          };
        },
      }),
    },
  };
});
vi.mock("@/db/schema", () => ({
  episodes: {},
  seasons: {},
  shows: {},
  users: { table: "users", id: "users.id" },
  watchProgress: {
    table: "watch_progress",
    userId: "watch_progress.user_id",
    episodeId: "watch_progress.episode_id",
    positionSeconds: "watch_progress.position_seconds",
    maxPositionSeconds: "watch_progress.max_position_seconds",
  },
  watchDays: { table: "watch_days" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...filters: unknown[]) => filters,
  eq: (column: unknown, value: unknown) => [column, value],
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

import { NextRequest } from "next/server";
import { users, watchProgress } from "@/db/schema";
import { GET, POST } from "./route";

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
  h.users = new Set(["user_1"]);
  h.clerkUser.mockReset().mockResolvedValue({
    primaryEmailAddress: { emailAddress: "viewer@example.invalid" },
    emailAddresses: [],
  });
  h.progress = new Map();
  h.failNextWrite = null;
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

// #303 item 1 — a fresh in-app sign-up whose Clerk user.created webhook is
// late has no `users` mirror row yet, so the watch_progress write fails its
// foreign key. The web heals that gap on the watch page's render; the app
// never renders one, so the save heals it itself — once — and retries once.
describe("POST /api/v1/progress — a missing users row (late webhook)", () => {
  const body = { episodeId: EPISODE, positionSeconds: 42, completed: false };

  beforeEach(() => {
    h.users = new Set(); // the webhook has not landed
  });

  it("syncs the row from Clerk, retries the save once and answers 200", async () => {
    const res = await POST(post(body));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(h.clerkUser).toHaveBeenCalledTimes(1);
    // The mirror row the webhook would have written — idempotently, so a
    // webhook landing at the same moment wins without an error.
    expect(h.inserts.filter((c) => c.table === users)).toEqual([
      {
        table: users,
        values: { id: "user_1", email: "viewer@example.invalid" },
        conflict: "do_nothing",
      },
    ]);
    const [write] = progressWrites();
    expect(write.values).toMatchObject({ userId: "user_1", episodeId: EPISODE, positionSeconds: 42 });
  });

  it("answers 503 `unavailable` and re-creates nothing for an account Clerk no longer has (erased)", async () => {
    // Clerk deletes the user before it sends the user.deleted that erases
    // the row; its API then answers 404, which the SDK throws. A session
    // token that is still valid for its last seconds must not bring the
    // account back.
    h.clerkUser.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(post(body));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("unavailable");
    expect(h.users.size).toBe(0);
    expect(h.inserts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "v1/progress: users mirror not healed",
      expect.objectContaining({ userId: "user_1", step: "sync_failed" }),
    );
  });

  it("answers 503 when the sync finds no user (no address to mirror)", async () => {
    h.clerkUser.mockResolvedValue({ primaryEmailAddress: null, emailAddresses: [] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await POST(post(body));

    expect(res.status).toBe(503);
    expect(h.inserts).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "v1/progress: users mirror not healed",
      expect.objectContaining({ step: "no_user" }),
    );
  });

  it("answers 503 when the retry fails too — one heal, one retry, never a second", async () => {
    // The row is healed, but the retry still fails (the database drops the
    // connection). The app's saver tries again on its next tick.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.clerkUser.mockImplementation(async () => {
      h.failNextWrite = new Error("connection terminated");
      return { primaryEmailAddress: { emailAddress: "viewer@example.invalid" }, emailAddresses: [] };
    });

    const res = await POST(post(body));

    expect(res.status).toBe(503);
    expect(h.clerkUser).toHaveBeenCalledTimes(1);
    expect(progressWrites()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "v1/progress: users mirror not healed",
      expect.objectContaining({ step: "retry_failed" }),
    );
  });

  it("leaves any other failure as it was: it propagates (the framework's 500), with no sync", async () => {
    h.users = new Set(["user_1"]);
    h.failNextWrite = new Error("connection terminated");

    await expect(POST(post(body))).rejects.toThrow("connection terminated");
    expect(h.clerkUser).not.toHaveBeenCalled();
  });
});

// #303 item 2 — the app's per-episode resume read. Only the one episode per
// show on the continue rail used to resume; every other partly watched
// episode opened at 0:00 and lost its place to the next save.
describe("GET /api/v1/progress — the viewer's resume point for one episode", () => {
  function get(episodeId?: string): NextRequest {
    const url = new URL("https://matio.tv/api/v1/progress");
    if (episodeId !== undefined) url.searchParams.set("episodeId", episodeId);
    return new NextRequest(url);
  }

  it("is 401 for an anonymous caller", async () => {
    h.userId = null;
    h.progress.set(`user_1/${EPISODE}`, { positionSeconds: 240 });

    const res = await GET(get(EPISODE));

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("is 400 without a well-formed episode id", async () => {
    for (const episodeId of [undefined, "", "nope", `${EPISODE}x`]) {
      const res = await GET(get(episodeId));
      expect(res.status, String(episodeId)).toBe(400);
    }
  });

  it("answers 0 when the episode has no row", async () => {
    const res = await GET(get(EPISODE));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ positionSeconds: 0 });
  });

  it("answers the stored position — the caller's own row, never another viewer's", async () => {
    h.progress.set(`user_1/${EPISODE}`, { positionSeconds: 240 });
    h.progress.set(`user_2/${EPISODE}`, { positionSeconds: 999 });

    const res = await GET(get(EPISODE));

    await expect(res.json()).resolves.toEqual({ positionSeconds: 240 });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
