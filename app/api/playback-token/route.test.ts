import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The web's token route: the one seam that actually hands out a Mux JWT.
// Everything it reaches for is faked, because what is under test is the
// DECISION — who may play what, and which machine-readable reason a refusal
// carries (the player routes the viewer by that reason). The twin for the
// app lives in app/api/v1/playback-token/route.test.ts.
//
// The gate cases are #198: with REQUIRE_SIGNUP=1 the episode's own tier
// decides for anonymous viewers, instead of a blanket wall over everything.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  row: undefined as
    | { playbackId: string | null; showId: string; access: string }
    | undefined,
  cookie: undefined as string | undefined,
  hasActiveSubscription: vi.fn(),
  showHasTierGating: vi.fn(),
  findTrialSession: vi.fn(),
  mintTrialSession: vi.fn(),
  stampSignupWall: vi.fn(),
  stampVisitorWallSeen: vi.fn(),
  sign: vi.fn(),
  FakeRateLimit: class FakeRateLimit extends Error {},
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (h.cookie ? { value: h.cookie } : undefined),
  }),
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
  },
}));
vi.mock("@/db/schema", () => ({ episodes: {}, seasons: {}, shows: {} }));
vi.mock("drizzle-orm", () => ({
  and: () => undefined,
  eq: () => undefined,
  isNull: () => undefined,
}));
vi.mock("@/lib/episode-access", async (importOriginal) => {
  // resolveRequestTier is the rule under test — the real one, not a stub.
  const actual = await importOriginal<typeof import("@/lib/episode-access")>();
  return {
    resolveRequestTier: actual.resolveRequestTier,
    showHasTierGating: h.showHasTierGating,
  };
});
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: h.hasActiveSubscription,
}));
vi.mock("@/lib/mux-token", () => ({ signMuxPlaybackToken: h.sign }));
vi.mock("@/lib/attribution", () => ({
  readAttributionCookiesFromRequest: () => ({}),
}));
vi.mock("@/lib/visitor", () => ({
  stampVisitorWallSeen: h.stampVisitorWallSeen,
}));
vi.mock("@/lib/trial", () => ({
  TRIAL_COOKIE: "trial_session",
  TRIAL_DURATION_SECONDS: 60,
  TrialRateLimitError: h.FakeRateLimit,
  findTrialSession: h.findTrialSession,
  mintTrialSession: h.mintTrialSession,
  stampSignupWall: h.stampSignupWall,
  getClientIp: () => "203.0.113.7",
  hashClientIp: () => "hashed-ip",
}));

import { GET } from "./route";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SHOW = "show-1";

function get(episodeId: string | null = EPISODE): Parameters<typeof GET>[0] {
  const url = new URL("https://matio.tv/api/playback-token");
  if (episodeId) url.searchParams.set("episode_id", episodeId);
  return {
    nextUrl: url,
    cookies: { get: () => undefined },
    headers: new Headers(),
  } as unknown as Parameters<typeof GET>[0];
}

/** Free mode + REQUIRE_SIGNUP=1 — what production runs today. */
function gateMode() {
  vi.stubEnv("PAYMENTS_ENABLED", "");
  vi.stubEnv("REQUIRE_SIGNUP", "1");
}

beforeEach(() => {
  h.userId = null;
  h.cookie = undefined;
  h.row = { playbackId: "pb-1", showId: SHOW, access: "free" };
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  h.showHasTierGating.mockReset().mockResolvedValue(true);
  h.findTrialSession.mockReset().mockResolvedValue(null);
  h.mintTrialSession.mockReset().mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
  });
  h.stampSignupWall.mockReset().mockResolvedValue(undefined);
  h.stampVisitorWallSeen.mockReset().mockResolvedValue(undefined);
  h.sign.mockReset().mockReturnValue("signed-jwt");
  vi.stubEnv("PAYMENTS_ENABLED", "");
  vi.stubEnv("REQUIRE_SIGNUP", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/playback-token — input and lookup", () => {
  it("refuses a request with no episode id", async () => {
    const res = await GET(get(null));
    expect(res.status).toBe(400);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("404s an episode that is not ready, or whose show is unpublished", async () => {
    h.row = undefined;
    const res = await GET(get());
    expect(res.status).toBe(404);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("404s a ready episode with no playback id rather than signing nothing", async () => {
    h.row = { playbackId: null, showId: SHOW, access: "free" };
    const res = await GET(get());
    expect(res.status).toBe(404);
  });
});

describe("signup gate (REQUIRE_SIGNUP=1) — the episode's tier decides (#198)", () => {
  it("mints for an anonymous viewer on a FREE episode — no account needed", async () => {
    gateMode();
    h.row = { playbackId: "pb-1", showId: SHOW, access: "free" };

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: "signed-jwt", mode: "free" });
    // The anonymous funnel row is minted on this first free play.
    expect(h.mintTrialSession).toHaveBeenCalledTimes(1);
  });

  it.each([["member"], ["subscriber"]])(
    "refuses an anonymous viewer on a %s episode with reason signup_required",
    async (access) => {
      gateMode();
      h.row = { playbackId: "pb-1", showId: SHOW, access };

      const res = await GET(get());

      expect(res.status).toBe(403);
      // The player routes on this reason: signup wall, not paywall — with
      // payments off a paywall would send the viewer to /subscribe, which
      // redirects home.
      expect(await res.json()).toMatchObject({ reason: "signup_required" });
      expect(h.sign).not.toHaveBeenCalled();
      expect(h.stampVisitorWallSeen).toHaveBeenCalledTimes(1);
    },
  );

  it.each([["free"], ["member"], ["subscriber"]])(
    "lets a signed-in viewer with no subscription play a %s episode",
    async (access) => {
      gateMode();
      h.userId = "user_1";
      h.row = { playbackId: "pb-1", showId: SHOW, access };

      const res = await GET(get());

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ mode: "member" });
    },
  );
});

describe("open free mode — everything plays", () => {
  it("mints for an anonymous viewer even on a subscriber episode", async () => {
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "free" });
  });
});

describe("paid mode — the tier means money again", () => {
  it("hands a subscriber the long-lived token", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.userId = "user_1";
    h.hasActiveSubscription.mockResolvedValue(true);
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "subscriber" });
  });

  it("refuses a signed-in non-subscriber on a subscriber episode with subscribe_required", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.userId = "user_1";
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "subscribe_required" });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("still asks an anonymous viewer for an account on a member episode", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "member" };

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "signup_required" });
  });

  it("keeps a free episode open to everyone", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "free" };

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "free" });
  });
});
