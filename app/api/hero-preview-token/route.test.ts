import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  published: [] as Array<{
    id: string;
    featured: boolean;
    heroImageUrl: string | null;
  }>,
  resolve: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  getPublishedShows: async () => h.published,
}));
// The featured-show rule is the real one; only the DB-backed resolver is
// faked, so the route is proven to hand the resolver the SAME show the page
// would render.
vi.mock("@/lib/hero-preview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hero-preview")>()),
  resolveHeroPreview: h.resolve,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ episodes: {}, seasons: {} }));
vi.mock("@/lib/mux-token", () => ({ signMuxPlaybackToken: () => "unused" }));
vi.mock("@/lib/trial", () => ({ TRIAL_DURATION_SECONDS: 60 }));

import { GET } from "./route";

const show = (id: string, featured = false) => ({
  id,
  featured,
  heroImageUrl: null,
});

beforeEach(() => {
  h.published = [];
  h.resolve.mockReset();
});

describe("GET /api/hero-preview-token", () => {
  it("answers 404 with no catalog, without touching the resolver", async () => {
    const res = await GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "no_preview" });
    expect(h.resolve).not.toHaveBeenCalled();
  });

  it("resolves the preview for the show the page features", async () => {
    h.published = [show("newest"), show("flagged", true)];
    h.resolve.mockResolvedValue({
      previewPlaybackId: "pb-hero",
      previewToken: "signed-dummy-token",
    });

    const res = await GET();

    expect(h.resolve).toHaveBeenCalledWith("flagged");
    expect(res.status).toBe(200);
    // A 60s token must never be cached anywhere between us and the browser.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      playbackId: "pb-hero",
      token: "signed-dummy-token",
    });
  });

  it("answers 404 when the featured show has nothing ready to preview", async () => {
    h.published = [show("only")];
    h.resolve.mockResolvedValue({ previewPlaybackId: null, previewToken: null });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_preview" });
  });

  it("passes a token-less preview through for a public asset", async () => {
    h.published = [show("only")];
    h.resolve.mockResolvedValue({ previewPlaybackId: "pb-pub", previewToken: null });

    const body = await (await GET()).json();

    expect(body).toEqual({ playbackId: "pb-pub", token: null });
  });
});
