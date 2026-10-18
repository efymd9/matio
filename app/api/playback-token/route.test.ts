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
// The paid-mode cases are #462: registration first, then the paywall, and no
// 60-second preview for anyone.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  row: undefined as
    | { playbackId: string | null; showId: string; access: string }
    | undefined,
  cookie: undefined as string | undefined,
  hasActiveSubscription: vi.fn(),
  findTrialSession: vi.fn(),
  mintTrialSession: vi.fn(),
  stampSignupWall: vi.fn(),
  stampVisitorWallSeen: vi.fn(),
  sign: vi.fn(),
  FakeRateLimit: class FakeRateLimit extends Error {},
  // true = the REAL getClientIp/hashClientIp (the #351 bucket cases); every
  // other case keeps the constant IP and the constant hash.
  realIp: false,
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
  return { resolveRequestTier: actual.resolveRequestTier };
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
vi.mock("@/lib/trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trial")>();
  return {
    TRIAL_COOKIE: "trial_session",
    TrialRateLimitError: h.FakeRateLimit,
    findTrialSession: h.findTrialSession,
    mintTrialSession: h.mintTrialSession,
    stampSignupWall: h.stampSignupWall,
    getClientIp: (req: Parameters<typeof actual.getClientIp>[0]) =>
      h.realIp ? actual.getClientIp(req) : "203.0.113.7",
    hashClientIp: (ip: string) => (h.realIp ? actual.hashClientIp(ip) : "hashed-ip"),
  };
});

import { GET } from "./route";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SHOW = "show-1";

function get(
  episodeId: string | null = EPISODE,
  clientIp?: string,
): Parameters<typeof GET>[0] {
  const url = new URL("https://matio.tv/api/playback-token");
  if (episodeId) url.searchParams.set("episode_id", episodeId);
  const headers = new Headers();
  if (clientIp) headers.set("x-vercel-forwarded-for", clientIp);
  return {
    nextUrl: url,
    cookies: { get: () => undefined },
    headers,
  } as unknown as Parameters<typeof GET>[0];
}

/** Free mode + REQUIRE_SIGNUP=1 — what production runs today. */
function gateMode() {
  vi.stubEnv("PAYMENTS_ENABLED", "");
  vi.stubEnv("REQUIRE_SIGNUP", "1");
}

beforeEach(() => {
  h.userId = null;
  h.realIp = false;
  h.cookie = undefined;
  h.row = { playbackId: "pb-1", showId: SHOW, access: "free" };
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
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
    // The anonymous funnel row is minted on this first free play — as a WEB
    // row, the only kind the IP fallback of the account link may claim (#349).
    expect(h.mintTrialSession).toHaveBeenCalledTimes(1);
    expect(h.mintTrialSession.mock.calls[0][0]).toMatchObject({
      showId: SHOW,
      kind: "episodes",
      client: "web",
    });
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

// #351: the per-IP trial brake counts rows by this hash, so two source
// addresses of one IPv6 /64 must hand the mint the SAME hash — a client that
// rotates inside its prefix would otherwise open a fresh bucket every time.
// The real getClientIp/hashClientIp here, not the constant stand-ins.
describe("the trial mint's IP bucket (#351)", () => {
  async function mintedHash(clientIp: string): Promise<string> {
    gateMode();
    h.realIp = true;
    h.mintTrialSession.mockClear();
    await GET(get(EPISODE, clientIp));
    expect(h.mintTrialSession).toHaveBeenCalledTimes(1);
    return h.mintTrialSession.mock.calls[0][0].ipHash;
  }

  it("two addresses of one /64 share a bucket; the next /64 does not", async () => {
    const a = await mintedHash("2001:db8:abcd:12:1::1");
    const b = await mintedHash("2001:db8:abcd:12:ffff:ffff:ffff:fffe");
    const other = await mintedHash("2001:db8:abcd:13::1");

    expect(a).toBe(b);
    expect(other).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("IPv4 and its IPv4-mapped spelling share a bucket", async () => {
    expect(await mintedHash("::ffff:203.0.113.7")).toBe(await mintedHash("203.0.113.7"));
    expect(await mintedHash("203.0.113.8")).not.toBe(await mintedHash("203.0.113.7"));
  });
});

describe("open free mode — everything plays", () => {
  it("mints for an anonymous viewer even on a subscriber episode", async () => {
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "free" });
    // The funnel row is a free-tier one — never a 60s preview (#462).
    expect(h.mintTrialSession.mock.calls[0][0]).toMatchObject({
      kind: "episodes",
    });
  });

  it.each([["free"], ["member"], ["subscriber"]])(
    "plays a %s episode for a signed-in viewer on the member path",
    async (access) => {
      h.userId = "user_1";
      h.row = { playbackId: "pb-1", showId: SHOW, access };

      const res = await GET(get());

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ mode: "member" });
    },
  );
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
    // The whole episode: the teaser clip is the home hero's alone
    // (lib/hero-preview.ts) — a third argument here would cut a subscriber's
    // episode to its first minute.
    expect(h.sign).toHaveBeenCalledWith("pb-1", 3600);
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

// #462: every episode subscriber-tier, and pressing play asks for an account
// first, then for money. The legacy 60-second preview is gone for everyone —
// an anonymous request must never mint a kind='preview' row (or any row: the
// sign-up wall is not a free play).
describe("paid mode — registration first, then the paywall (#462)", () => {
  const COOKIE = "1eaf0000-dead-4bee-8f00-00000000beef";

  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };
  });

  it("asks an anonymous viewer for an account on a subscriber episode — no preview, no trial row", async () => {
    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "signup_required" });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.findTrialSession).not.toHaveBeenCalled();
    expect(h.mintTrialSession).not.toHaveBeenCalled();
    expect(res.cookies.get("trial_session")).toBeUndefined();
    // The wall impression is still measured, on the visit ledger.
    expect(h.stampVisitorWallSeen).toHaveBeenCalledTimes(1);
  });

  it("with a trial cookie from an earlier visit, only stamps the wall on it — still no preview", async () => {
    h.cookie = COOKIE;
    // Even a row whose 60s window is still open buys nothing any more.
    h.findTrialSession.mockResolvedValue({
      expiresAt: new Date(Date.now() + 30_000),
    });

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "signup_required" });
    expect(h.stampSignupWall).toHaveBeenCalledWith(COOKIE, SHOW);
    expect(h.mintTrialSession).not.toHaveBeenCalled();
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("shows a signed-in non-subscriber the paywall — subscribe_required, the trial store untouched", async () => {
    h.userId = "user_1";
    h.cookie = COOKIE;

    const res = await GET(get());

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "subscribe_required" });
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.findTrialSession).not.toHaveBeenCalled();
    expect(h.mintTrialSession).not.toHaveBeenCalled();
    expect(h.stampVisitorWallSeen).not.toHaveBeenCalled();
  });

  it("plays for a subscriber", async () => {
    h.userId = "user_1";
    h.hasActiveSubscription.mockResolvedValue(true);

    const res = await GET(get());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      token: "signed-jwt",
      mode: "subscriber",
      expiresIn: 3600,
    });
    expect(h.mintTrialSession).not.toHaveBeenCalled();
  });
});
