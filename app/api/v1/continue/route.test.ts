import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The app's continue-watching rail. The resolver behind it is the web's
// getContinueWatching (its own suite proves the published/ready filters and
// the collapse rules); what this route owns is the wire shape a shipped
// binary parses — absolute media URLs, ISO timestamps — and who may ask.
const h = vi.hoisted(() => ({
  userId: null as string | null,
  items: [] as Record<string, unknown>[],
  getContinueWatching: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
}));
vi.mock("@/lib/continue-watching", () => ({
  getContinueWatching: h.getContinueWatching,
}));

import { GET } from "./route";

const ITEM = {
  show: {
    slug: "the-scarlet-oath",
    title: "The Scarlet Oath",
    orientation: "vertical",
    heroImageUrl: "/shows/legacy-hero.png",
    posterImageUrl: "https://x.public.blob.vercel-storage.com/shows/poster.png",
  },
  episodeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  episodeNumber: 2,
  episodeTitle: "Second oath",
  positionSeconds: 120,
  durationSeconds: 600,
  fraction: 0.2,
  updatedAt: new Date("2026-09-01T10:00:00Z"),
};

beforeEach(() => {
  h.userId = "user_1";
  h.items = [ITEM];
  h.getContinueWatching.mockReset().mockImplementation(async () => h.items);
});

describe("GET /api/v1/continue", () => {
  it("is 401 for an anonymous caller and never runs the query", async () => {
    // The resolver's anonymous branch reads the web's trial cookie, which a
    // native client never holds — an empty rail there would be a lie.
    h.userId = null;
    const res = await GET();

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(h.getContinueWatching).not.toHaveBeenCalled();
  });

  it("returns the tiles in the app's DTO shape", async () => {
    const body = await (await GET()).json();

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      show: { slug: "the-scarlet-oath", title: "The Scarlet Oath", orientation: "vertical" },
      episodeId: ITEM.episodeId,
      episodeNumber: 2,
      episodeTitle: "Second oath",
      positionSeconds: 120,
      durationSeconds: 600,
      fraction: 0.2,
      updatedAt: "2026-09-01T10:00:00.000Z",
    });
  });

  it("absolutizes legacy artwork paths and leaves Blob URLs alone", async () => {
    const [item] = (await (await GET()).json()).items;
    expect(item.show.heroImageUrl).toMatch(/^https:\/\/.*\/shows\/legacy-hero\.png$/);
    expect(item.show.posterImageUrl).toBe(ITEM.show.posterImageUrl);
  });

  it("answers an empty list, not an error, when there is nothing to resume", async () => {
    h.items = [];
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("is a per-user answer and stays out of caches", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
