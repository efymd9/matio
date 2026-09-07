import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  show: undefined as Record<string, unknown> | undefined,
  episodes: [] as Record<string, unknown>[],
  thumbnail: vi.fn(),
  showWhere: undefined as unknown,
}));

// Two sequential queries: the show, then its episodes. The fake dispatches on
// which chain the route walks (`.limit()` vs `.orderBy()`).
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (clause: unknown) => {
          h.showWhere = clause;
          return { limit: async () => (h.show ? [h.show] : []) };
        },
        innerJoin: () => ({
          where: () => ({ orderBy: async () => h.episodes }),
        }),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({ episodes: {}, seasons: {}, shows: {} }));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  asc: () => undefined,
  eq: () => undefined,
  isNull: () => undefined,
}));
vi.mock("@/lib/mux-token", () => ({ muxThumbnailUrl: h.thumbnail }));
// Same exclusion as /v1/catalog — presence in the WHERE is what is asserted.
vi.mock("@/lib/api/v1", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/v1")>()),
  linearShowsOnly: () => "linear-shows-only",
}));

import { GET } from "./route";

const SHOW = {
  id: "show-1",
  slug: "the-scarlet-oath",
  title: "The Scarlet Oath",
  description: "A dark romance.",
  genre: ["drama"],
  orientation: "vertical",
  posterImageUrl: "/shows/legacy-poster.png",
  heroImageUrl: null,
  featured: false,
  justReleased: true,
  popularNow: false,
};

const EPISODE = {
  id: "ep-1",
  seasonNumber: 1,
  number: 1,
  title: "Oath",
  description: "Pilot.",
  durationSeconds: 420,
  access: "subscriber",
  releasedAt: new Date("2026-08-01T10:00:00Z"),
  introStartSeconds: 0,
  introEndSeconds: 12,
  muxPlaybackId: "secret-playback-id",
  muxPlaybackPolicy: "signed",
};

function req() {
  return {} as unknown as Parameters<typeof GET>[0];
}
function ctx(slug = "the-scarlet-oath") {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  h.show = SHOW;
  h.episodes = [EPISODE];
  h.thumbnail.mockReset().mockReturnValue("https://image.mux.com/thumb.jpg?token=t");
});

describe("GET /api/v1/shows/:slug", () => {
  it("is 404 for an unknown, unpublished or soft-deleted show", async () => {
    // The filter lives in the query, so no row IS the refusal.
    h.show = undefined;
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("returns the show with its ready episodes and a derived count", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body).toMatchObject({
      slug: "the-scarlet-oath",
      synopsis: "A dark romance.",
      orientation: "vertical",
      episodeCount: 1,
    });
    expect(body.episodes[0]).toMatchObject({
      id: "ep-1",
      seasonNumber: 1,
      number: 1,
      access: "subscriber",
      introEndSeconds: 12,
    });
  });

  it("NEVER exposes a Mux playback id — only a signed thumbnail", async () => {
    // The load-bearing invariant of the whole surface: a playback id plus a
    // leaked signing key is video; a thumbnail JWT (audience 't') is not.
    const raw = JSON.stringify(await (await GET(req(), ctx())).json());
    expect(raw).not.toContain("secret-playback-id");
    expect(raw).toContain("image.mux.com");
    expect(h.thumbnail).toHaveBeenCalledWith("secret-playback-id", "signed", {
      width: 640,
      ttlSeconds: 60 * 60 * 6,
    });
  });

  it("serializes dates as ISO strings and keeps nulls null", async () => {
    const body = await (await GET(req(), ctx())).json();
    expect(body.episodes[0].releasedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(body.heroImageUrl).toBeNull();

    h.episodes = [{ ...EPISODE, releasedAt: null, muxPlaybackId: null }];
    const second = await (await GET(req(), ctx())).json();
    expect(second.episodes[0].releasedAt).toBeNull();
    expect(second.episodes[0].thumbnailUrl).toBeNull();
  });

  it("caps its cache at the thumbnail lifetime it embeds", async () => {
    const res = await GET(req(), ctx());
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("answers 200 with an empty episode list for a show with nothing ready", async () => {
    h.episodes = [];
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.episodes).toEqual([]);
    expect(body.episodeCount).toBe(0);
  });

  it("is 404 for a show with branching content, like it is absent from the catalog", async () => {
    // Excluded in the show lookup's WHERE (#143), so the answer is the same
    // not_found as for an unpublished show — nothing leaks about the branch.
    await GET(req(), ctx());
    expect(h.showWhere).toContainEqual("linear-shows-only");
  });
});
