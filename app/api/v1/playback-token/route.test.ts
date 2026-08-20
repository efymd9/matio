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
  showHasTierGating: vi.fn(),
  findTrialSession: vi.fn(),
  mintTrialSession: vi.fn(),
  stampSignupWall: vi.fn(),
  sign: vi.fn(),
  // Declared inside vi.hoisted: `vi.mock` factories are lifted above every
  // top-level statement, so a class declared normally is still in its temporal
  // dead zone when the trial mock is built.
  FakeRateLimit: class FakeRateLimit extends Error {},
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
vi.mock("@/lib/episode-access", () => ({
  getOrderedReadyEpisodeIds: h.orderedEpisodeIds,
  showHasTierGating: h.showHasTierGating,
}));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: h.hasActiveSubscription,
}));
vi.mock("@/lib/mux-token", () => ({ signMuxPlaybackToken: h.sign }));
vi.mock("@/lib/attribution", () => ({ EMPTY_ATTRIBUTION: {} }));

vi.mock("@/lib/trial", () => ({
  TRIAL_DURATION_SECONDS: 60,
  TrialRateLimitError: h.FakeRateLimit,
  findTrialSession: h.findTrialSession,
  mintTrialSession: h.mintTrialSession,
  stampSignupWall: h.stampSignupWall,
  getClientIp: () => "203.0.113.7",
  hashClientIp: () => "hashed-ip",
}));

import { DEVICE_ID_HEADER } from "@/lib/api/v1";
import { POST } from "./route";

const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
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

beforeEach(() => {
  h.userId = null;
  h.row = { playbackId: "pb-1", showId: SHOW, access: "free" };
  h.hasActiveSubscription.mockReset().mockResolvedValue(false);
  h.orderedEpisodeIds.mockReset().mockResolvedValue([EPISODE, OTHER_EPISODE]);
  h.showHasTierGating.mockReset().mockResolvedValue(false);
  h.findTrialSession.mockReset().mockResolvedValue(null);
  h.mintTrialSession.mockReset().mockResolvedValue({
    expiresAt: new Date(Date.now() + 60_000),
  });
  h.stampSignupWall.mockReset().mockResolvedValue(undefined);
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

  it("answers `subscribe_required` on a tier-gated show in paid mode", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    h.userId = "user_1";
    h.showHasTierGating.mockResolvedValue(true);
    h.row = { playbackId: "pb-1", showId: SHOW, access: "subscriber" };

    const res = await POST(post({ episodeId: EPISODE }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.reason).toBe("subscribe_required");
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
