import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Everything this route reaches for is faked, because what is under test is
// the DECISION it makes — who may play what, and which machine-readable reason
// a refusal carries. A shipped binary branches on exactly those answers.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  row: undefined as
    | { playbackId: string | null; showId: string; access: string }
    | undefined,
  hasActiveSubscription: vi.fn(),
  orderedEpisodeIds: vi.fn(),
  findTrialSession: vi.fn(),
  mintTrialSession: vi.fn(),
  stampSignupWall: vi.fn(),
  sign: vi.fn(),
  signStoryboard: vi.fn(),
  // Declared inside vi.hoisted: `vi.mock` factories are lifted above every
  // top-level statement, so a class declared normally is still in its temporal
  // dead zone when the trial mock is built.
  FakeRateLimit: class FakeRateLimit extends Error {},
  // true = the REAL getClientIp/hashClientIp (the #351 bucket cases); every
  // other case keeps the constant IP and the constant hash.
  realIp: false,
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
  },
}));
vi.mock("@/db/schema", () => ({ episodes: {}, seasons: {}, shows: {} }));
vi.mock("drizzle-orm", () => ({
  and: () => undefined,
  eq: () => undefined,
  isNull: () => undefined,
}));
// The tier rule itself is the real one (#462: the app and the web answer an
// anonymous viewer the same way); only the ordering read is faked.
vi.mock("@/lib/episode-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/episode-access")>()),
  getOrderedReadyEpisodeIds: h.orderedEpisodeIds,
}));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: h.hasActiveSubscription,
}));
vi.mock("@/lib/mux-token", () => ({
  signMuxPlaybackToken: h.sign,
  signMuxStoryboardToken: h.signStoryboard,
}));
vi.mock("@/lib/attribution", () => ({ EMPTY_ATTRIBUTION: {} }));

vi.mock("@/lib/trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trial")>();
  return {
    TrialRateLimitError: h.FakeRateLimit,
    findTrialSession: h.findTrialSession,
    mintTrialSession: h.mintTrialSession,
    stampSignupWall: h.stampSignupWall,
    getClientIp: (req: Parameters<typeof actual.getClientIp>[0]) =>
      h.realIp ? actual.getClientIp(req) : "203.0.113.7",
    hashClientIp: (ip: string) => (h.realIp ? actual.hashClientIp(ip) : "hashed-ip"),
  };
});

import { DEVICE_ID_HEADER } from "@/lib/api/v1";
import { POST } from "./route";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const DEVICE = "9c858901-8a57-4791-81fe-4c455b099bc9";
const SHOW = "show-1";

function post(
  body: unknown,
  opts: { device?: string | null; clientIp?: string } = {},
): Parameters<typeof POST>[0] {
  const headers = new Headers();
  const device = opts.device === undefined ? DEVICE : opts.device;
  if (device) headers.set(DEVICE_ID_HEADER, device);
  if (opts.clientIp) headers.set("x-vercel-forwarded-for", opts.clientIp);
  return {
    headers,
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  h.userId = null;
  h.realIp = false;
  h.row = { playbackId: "pb-1", showId: SHOW, access: "free" };
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  h.orderedEpisodeIds.mockReset().mockResolvedValue([EPISODE, OTHER_EPISODE]);
  h.findTrialSession.mockReset().mockResolvedValue(null);
  h.mintTrialSession.mockReset().mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
  });
  h.stampSignupWall.mockReset().mockResolvedValue(undefined);
  h.sign.mockReset().mockReturnValue("signed-jwt");
  h.signStoryboard.mockReset().mockReturnValue("signed-storyboard-jwt");
  vi.stubEnv("PAYMENTS_ENABLED", "");
  vi.stubEnv("REQUIRE_SIGNUP", "");
  vi.stubEnv("APP_FREE_WITH_ACCOUNT", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/playback-token — input and lookup", () => {
  it("rejects a body without a valid episode UUID", async () => {
    for (const body of [null, {}, { episodeId: 42 }, { episodeId: "nope" }]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
    }
  });

  it("is 404 for an episode that is not ready, or whose show is unpublished", async () => {
    // The query itself carries the ready/published/not-deleted filter, so an
    // empty result IS that refusal — a leaked draft id must not mint a token.
    h.row = undefined;
    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(404);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("is 404 when the episode row carries no playback id", async () => {
    h.row = { playbackId: null, showId: SHOW, access: "free" };
    expect((await POST(post({ episodeId: EPISODE }))).status).toBe(404);
    expect(h.sign).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/playback-token — who gets a token", () => {
  it("gives a subscriber a token regardless of the episode's tier", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.userId = "user_1";
    h.hasActiveSubscription.mockResolvedValue(true);
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: EPISODE }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ playbackId: "pb-1", token: "signed-jwt", mode: "subscriber" });
    expect(body.expiresIn).toBeLessThanOrEqual(3600);
  });

  it("plays everything for a signed-in viewer in free mode", async () => {
    h.userId = "user_1";
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("member");
  });

  it("opens the gated show's FIRST episode to an anonymous device", async () => {
    // Deliberately softer than the web's hard REQUIRE_SIGNUP wall — the app
    // must not open on a login screen (App Store 5.1.1(v)).
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("free");
  });

  it("refuses the SECOND episode with `signup_required`", async () => {
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: OTHER_EPISODE }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.reason).toBe("signup_required");
    expect(h.sign).not.toHaveBeenCalled();
    // The wall is a funnel milestone, stamped on this device's row.
    expect(h.stampSignupWall).toHaveBeenCalledWith(DEVICE, SHOW);
  });

  it("answers `subscribe_required` to a signed-in non-subscriber in paid mode", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.userId = "user_1";
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("subscribe_required");
  });
});

describe("POST /api/v1/playback-token — the scrub preview's storyboard token (#375)", () => {
  it("comes with every token, for the same playback id and the same lifetime", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.userId = "user_1";
    h.hasActiveSubscription.mockResolvedValue(true);

    const body = await (await POST(post({ episodeId: EPISODE }))).json();

    expect(body.storyboardToken).toBe("signed-storyboard-jwt");
    expect(h.sign).toHaveBeenCalledWith("pb-1", 3600);
    expect(h.signStoryboard).toHaveBeenCalledWith("pb-1", 3600);
  });

  it("a refusal carries none — no frames of an episode the viewer may not watch", async () => {
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: OTHER_EPISODE }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.storyboardToken).toBeUndefined();
    expect(h.signStoryboard).not.toHaveBeenCalled();
  });
});


// #462: the legacy 60-second preview for all-subscriber shows is gone — for
// the app too. With every episode subscriber-tier, a non-subscriber gets the
// «Subscribers only» answer and nothing is minted: no token, no trial row.
describe("POST /api/v1/playback-token — paid mode, no preview (#462)", () => {
  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };
  });

  it("a signed-in non-subscriber gets `subscribe_required` at once — the trial store untouched", async () => {
    h.userId = "user_1";

    const res = await POST(post({ episodeId: EPISODE }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("subscribe_required");
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.signStoryboard).not.toHaveBeenCalled();
    expect(h.findTrialSession).not.toHaveBeenCalled();
    expect(h.mintTrialSession).not.toHaveBeenCalled();
  });

  it("an anonymous device is asked for an account first — the answer it is locked with up front, no preview row", async () => {
    // Registration first, then the paywall (#462) — the web's rule, and what
    // isEpisodeLockedForApp shows a signed-out viewer before any request.
    const res = await POST(post({ episodeId: EPISODE }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("signup_required");
    // The wall stamp on this device's row, like any sign-up ask; nothing else.
    expect(h.stampSignupWall).toHaveBeenCalledWith(DEVICE, SHOW);
    expect(h.findTrialSession).not.toHaveBeenCalled();
    expect(h.mintTrialSession).not.toHaveBeenCalled();
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("even a device whose old preview row is still open gets nothing", async () => {
    h.findTrialSession.mockResolvedValue({
      expiresAt: new Date(Date.now() + 30_000),
    });

    const res = await POST(post({ episodeId: EPISODE }));

    expect(res.status).toBe(403);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("a request with no device id is refused the same way, not as a bad request", async () => {
    const res = await POST(post({ episodeId: EPISODE }, { device: null }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("signup_required");
    expect(h.stampSignupWall).not.toHaveBeenCalled();
  });
});

// #476: the site charges, the app is free for any account. The token route
// asks appPaymentsEnabled() — the answer /v1/config reports — so what the app
// draws unlocked plays, and what it draws locked is refused the same way.
describe("POST /api/v1/playback-token — paid site, APP_FREE_WITH_ACCOUNT=1 (#476)", () => {
  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("APP_FREE_WITH_ACCOUNT", "1");
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };
  });

  it("a signed-in non-subscriber plays a subscriber episode on the member path — 1h, like a member", async () => {
    h.userId = "user_1";

    const res = await POST(post({ episodeId: EPISODE }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ playbackId: "pb-1", token: "signed-jwt", mode: "member" });
    expect(h.sign).toHaveBeenCalledWith("pb-1", 3600);
    // No funnel row for an account: the member path mints nothing.
    expect(h.mintTrialSession).not.toHaveBeenCalled();
  });

  it("an anonymous device is asked for an account — even for episode 1 (gate 0)", async () => {
    const res = await POST(post({ episodeId: EPISODE }));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.reason).toBe("signup_required");
    expect(h.sign).not.toHaveBeenCalled();
    expect(h.stampSignupWall).toHaveBeenCalledWith(DEVICE, SHOW);
  });

  it("a subscriber still plays as a subscriber — that check comes first and is unchanged", async () => {
    h.userId = "user_1";
    h.hasActiveSubscription.mockResolvedValue(true);

    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("subscriber");
  });

  it("APP_SIGNUP_GATE_EPISODES opens the first N to an anonymous device, and no deeper", async () => {
    vi.stubEnv("APP_SIGNUP_GATE_EPISODES", "1");

    const first = await POST(post({ episodeId: EPISODE }));
    expect(first.status).toBe(200);
    expect((await first.json()).mode).toBe("free");

    const second = await POST(post({ episodeId: OTHER_EPISODE }));
    expect(second.status).toBe(403);
    expect((await second.json()).error.reason).toBe("signup_required");
  });
});

describe("POST /api/v1/playback-token — tracking never blocks playback", () => {
  it("mints one trial row per (device, show) and reuses it after", async () => {
    await POST(post({ episodeId: EPISODE }));
    expect(h.mintTrialSession).toHaveBeenCalledTimes(1);
    expect(h.mintTrialSession.mock.calls[0][0]).toMatchObject({
      sessionToken: DEVICE,
      showId: SHOW,
      kind: "episodes",
      // A device row: the web's IP fallback must never link it (#349).
      client: "app",
    });

    h.findTrialSession.mockResolvedValue({ expiresAt: new Date() });
    await POST(post({ episodeId: EPISODE }));
    expect(h.mintTrialSession).toHaveBeenCalledTimes(1);
  });

  it("never stores a raw IP", async () => {
    await POST(post({ episodeId: EPISODE }));
    expect(h.mintTrialSession.mock.calls[0][0].ipHash).toBe("hashed-ip");
    expect(JSON.stringify(h.mintTrialSession.mock.calls[0][0])).not.toContain("203.0.113.7");
  });

  // #351: the per-IP trial brake counts rows by this hash, so two source
  // addresses of one IPv6 /64 must hand the mint the SAME hash — a client
  // that rotates inside its prefix would otherwise open a fresh bucket every
  // time. The real getClientIp/hashClientIp here, not the constant stand-ins.
  it("hands the mint one IP bucket per IPv6 /64", async () => {
    h.realIp = true;
    async function mintedHash(clientIp: string): Promise<string> {
      h.mintTrialSession.mockClear();
      await POST(post({ episodeId: EPISODE }, { clientIp }));
      expect(h.mintTrialSession).toHaveBeenCalledTimes(1);
      return h.mintTrialSession.mock.calls[0][0].ipHash;
    }

    const a = await mintedHash("2001:db8:abcd:12:1::1");
    const b = await mintedHash("2001:db8:abcd:12:ffff:ffff:ffff:fffe");
    const other = await mintedHash("2001:db8:abcd:13::1");

    expect(a).toBe(b);
    expect(other).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await mintedHash("::ffff:203.0.113.7")).toBe(await mintedHash("203.0.113.7"));
  });

  it("still plays free content when the rate limit trips", async () => {
    // Free content must never 429: a limiter hiccup degrades measurement only.
    h.mintTrialSession.mockRejectedValue(new h.FakeRateLimit("limit"));
    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("free");
  });

  it("still plays free content when the tracking write fails outright", async () => {
    h.findTrialSession.mockRejectedValue(new Error("db down"));
    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(200);
  });

  it("plays for a device that sends no id, writing nothing", async () => {
    const res = await POST(post({ episodeId: EPISODE }, { device: null }));
    expect(res.status).toBe(200);
    expect(h.mintTrialSession).not.toHaveBeenCalled();
  });

  it("keeps identity-shaped answers out of caches", async () => {
    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
