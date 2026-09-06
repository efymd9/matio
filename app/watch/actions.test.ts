import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The web's progress action after its core moved to lib/watch-progress.ts.
// What must not have changed: an anonymous call is a silent no-op, a
// signed-in call hands the SAME arguments to the shared write, and the
// action's return stays void whatever the write decides — the player fires
// it every 10s and never reads an answer.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  cookie: undefined as string | undefined,
  save: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (h.cookie ? { value: h.cookie } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("@/db", () => ({ db: { select: h.select } }));
vi.mock("@/db/schema", () => ({
  episodes: {},
  seasons: {},
  showReminders: {},
  shows: {},
  trialSessions: {},
  watchProgress: {},
  watchSegments: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => undefined,
  eq: () => undefined,
  gt: () => undefined,
  isNull: () => undefined,
  sql: () => undefined,
}));
vi.mock("@/lib/visitor", () => ({ stampVisitorWallSeen: vi.fn() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/subscription-access", () => ({ hasActiveSubscription: vi.fn() }));
vi.mock("@/lib/episode-access", () => ({
  getOrderedReadyEpisodeIds: vi.fn(),
  showHasTierGating: vi.fn(),
}));
vi.mock("@/lib/trial", () => ({
  TRIAL_COOKIE: "trial_session",
  TRIAL_DURATION_SECONDS: 60,
  getClientIp: () => "unknown",
  hashClientIp: () => "hashed",
  stampSignupWall: vi.fn(),
}));
vi.mock("@/lib/watch-progress", async (importOriginal) => {
  // The clamp is the real one — saveTrialPosition must keep sharing it.
  const actual = await importOriginal<typeof import("@/lib/watch-progress")>();
  return { ...actual, saveWatchProgressForUser: h.save };
});

import { saveTrialPosition, saveWatchProgress } from "./actions";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

beforeEach(() => {
  h.userId = null;
  h.cookie = undefined;
  h.save.mockReset().mockResolvedValue("saved");
  h.select.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("saveWatchProgress (web server action)", () => {
  it("is a silent no-op for an anonymous caller", async () => {
    await expect(saveWatchProgress(EPISODE, 12, false)).resolves.toBeUndefined();
    expect(h.save).not.toHaveBeenCalled();
  });

  it("hands the signed-in user's save to the shared write, arguments untouched", async () => {
    h.userId = "user_1";
    await expect(saveWatchProgress(EPISODE, 12.7, true)).resolves.toBeUndefined();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledWith("user_1", EPISODE, 12.7, true);
  });

  it("stays void when the write refuses — the player never reads an answer", async () => {
    h.userId = "user_1";
    for (const outcome of ["invalid_position", "not_found", "forbidden"]) {
      h.save.mockResolvedValueOnce(outcome);
      await expect(saveWatchProgress(EPISODE, 12, false)).resolves.toBeUndefined();
    }
  });
});

describe("saveTrialPosition still shares the position clamp", () => {
  it("drops an out-of-range position before any query", async () => {
    h.cookie = "trial-token";
    await expect(saveTrialPosition(EPISODE, -1)).resolves.toBeUndefined();
    expect(h.select).not.toHaveBeenCalled();
  });
});
