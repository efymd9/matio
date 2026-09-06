import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The query builder is faked down to the shape the resolver uses: two
// `select … limit(1)` reads in order — seasons first, then episodes. Each
// case queues the rows those reads should see.
const h = vi.hoisted(() => ({
  reads: [] as unknown[][],
  sign: vi.fn<(playbackId: string, ttl: number) => string>(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => h.reads.shift() ?? [] }),
        }),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({ episodes: {}, seasons: {} }));
vi.mock("drizzle-orm", () => ({
  and: () => undefined,
  asc: () => undefined,
  eq: () => undefined,
  inArray: () => undefined,
}));
vi.mock("@/lib/mux-token", () => ({ signMuxPlaybackToken: h.sign }));
vi.mock("@/lib/trial", () => ({ TRIAL_DURATION_SECONDS: 60 }));

import {
  HERO_PREVIEW_TTL_SECONDS,
  pickFeaturedShow,
  resolveHeroPreview,
} from "./hero-preview";

const SEASON = [{ id: "season-1" }];
const NONE = { previewPlaybackId: null, previewToken: null };

beforeEach(() => {
  h.reads = [];
  h.sign.mockReset();
  h.sign.mockReturnValue("signed-dummy-token");
});

describe("pickFeaturedShow", () => {
  const show = (
    id: string,
    extra: Partial<{ featured: boolean; heroImageUrl: string | null }> = {},
  ) => ({ id, featured: false, heroImageUrl: null, ...extra });

  it("prefers the admin-flagged show over one with hero artwork", () => {
    const flagged = show("flagged", { featured: true });
    const list = [show("art", { heroImageUrl: "/hero.jpg" }), flagged];
    expect(pickFeaturedShow(list)).toBe(flagged);
  });

  it("falls back to the first show with hero artwork, then to the newest", () => {
    const art = show("art", { heroImageUrl: "/hero.jpg" });
    expect(pickFeaturedShow([show("newest"), art])).toBe(art);
    const newest = show("newest");
    expect(pickFeaturedShow([newest, show("older")])).toBe(newest);
  });

  it("returns undefined for an empty catalog", () => {
    expect(pickFeaturedShow([])).toBeUndefined();
  });
});

describe("resolveHeroPreview", () => {
  it("caps the preview token at the trial duration", () => {
    expect(HERO_PREVIEW_TTL_SECONDS).toBe(60);
  });

  it("yields no preview for a show without seasons", async () => {
    h.reads = [[]];
    expect(await resolveHeroPreview("show-1")).toEqual(NONE);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("yields no preview when the first season has no ready episode", async () => {
    h.reads = [SEASON, []];
    expect(await resolveHeroPreview("show-1")).toEqual(NONE);
  });

  it("yields no preview when the ready episode has no playback id yet", async () => {
    h.reads = [SEASON, [{ muxPlaybackId: null, muxPlaybackPolicy: "signed" }]];
    expect(await resolveHeroPreview("show-1")).toEqual(NONE);
  });

  it("returns the playback id without a token for a public asset", async () => {
    h.reads = [SEASON, [{ muxPlaybackId: "pb-1", muxPlaybackPolicy: "public" }]];
    expect(await resolveHeroPreview("show-1")).toEqual({
      previewPlaybackId: "pb-1",
      previewToken: null,
    });
    expect(h.sign).not.toHaveBeenCalled();
  });

  it("signs a token with the capped TTL for a signed asset", async () => {
    h.reads = [SEASON, [{ muxPlaybackId: "pb-1", muxPlaybackPolicy: "signed" }]];
    expect(await resolveHeroPreview("show-1")).toEqual({
      previewPlaybackId: "pb-1",
      previewToken: "signed-dummy-token",
    });
    expect(h.sign).toHaveBeenCalledWith("pb-1", HERO_PREVIEW_TTL_SECONDS);
  });

  it("degrades to a token-less preview when signing fails (key unset)", async () => {
    h.sign.mockImplementation(() => {
      throw new Error("MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE_KEY must be set");
    });
    h.reads = [SEASON, [{ muxPlaybackId: "pb-1", muxPlaybackPolicy: "signed" }]];
    expect(await resolveHeroPreview("show-1")).toEqual({
      previewPlaybackId: "pb-1",
      previewToken: null,
    });
  });
});
