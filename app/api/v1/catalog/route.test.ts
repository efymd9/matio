import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The query builder is faked down to the shape this route uses; what matters
// is the DTO the app receives, since a shipped binary parses exactly it.
const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  where: undefined as unknown,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: (clause: unknown) => {
              h.where = clause;
              return { groupBy: () => ({ orderBy: async () => h.rows }) };
            },
          }),
        }),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({ episodes: {}, seasons: {}, shows: {} }));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  desc: () => undefined,
  eq: () => undefined,
  isNull: () => undefined,
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}));
// The branching-show exclusion is a correlated subquery built in lib/api/v1;
// its own test proves its shape — here only its PRESENCE in the WHERE matters.
vi.mock("@/lib/api/v1", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/v1")>()),
  linearShowsOnly: () => "linear-shows-only",
}));

import { GET } from "./route";

const ROW = {
  id: "show-1",
  slug: "the-scarlet-oath",
  title: "The Scarlet Oath",
  description: "A dark romance.",
  genre: ["drama"],
  orientation: "horizontal",
  posterImageUrl: "/shows/legacy-poster.png",
  heroImageUrl: "https://x.public.blob.vercel-storage.com/shows/hero.png",
  featured: true,
  justReleased: false,
  popularNow: true,
  // Postgres returns count() as a string via the driver.
  episodeCount: "3",
};

beforeEach(() => {
  h.rows = [ROW];
});

describe("GET /api/v1/catalog", () => {
  it("returns every published show in the app's DTO shape", async () => {
    const body = await (await GET()).json();
    expect(body.shows).toHaveLength(1);
    expect(body.shows[0]).toMatchObject({
      id: "show-1",
      slug: "the-scarlet-oath",
      title: "The Scarlet Oath",
      synopsis: "A dark romance.",
      orientation: "horizontal",
      featured: true,
      popularNow: true,
    });
  });

  it("coerces the episode count to a number", async () => {
    // The driver hands back a string; a client doing `count > 0` on "0" would
    // silently read every empty show as populated.
    const body = await (await GET()).json();
    expect(body.shows[0].episodeCount).toBe(3);
  });

  it("absolutizes legacy poster paths and leaves Blob URLs alone", async () => {
    const [show] = (await (await GET()).json()).shows;
    expect(show.posterImageUrl).toMatch(/^https:\/\/.*\/shows\/legacy-poster\.png$/);
    expect(show.heroImageUrl).toBe(ROW.heroImageUrl);
  });

  it("never leaks a playback id into the public catalog", async () => {
    const raw = JSON.stringify(await (await GET()).json());
    expect(raw).not.toMatch(/playbackId/i);
  });

  it("is CDN-cacheable because the answer is identical for every caller", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
  });

  it("answers with an empty list, not an error, when nothing is published", async () => {
    h.rows = [];
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).shows).toEqual([]);
  });

  it("leaves shows with branching content out of the catalog", async () => {
    // The native player has no fork overlay (#143): a branch-bearing show
    // would play as a broken linear run, so it is excluded in the WHERE.
    await GET();
    expect(h.where).toContainEqual("linear-shows-only");
  });
});
