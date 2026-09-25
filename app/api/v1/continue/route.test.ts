import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The app's continue-watching rail. The resolver behind it is the web's
// getContinueWatching (its own suite proves the published/ready filters and
// the collapse rules); what this route owns is the wire shape a shipped
// binary parses — absolute media URLs, ISO timestamps — who may ask, and the
// app's view of the catalog: no tile for a show the app hides (#288).
const h = vi.hoisted(() => ({
  userId: null as string | null,
  items: [] as Record<string, unknown>[],
  getContinueWatching: vi.fn(),
  // The slugs the app-visibility query answers with; null = every slug asked.
  visible: null as string[] | null,
  where: undefined as unknown,
  selects: 0,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
}));
vi.mock("@/lib/continue-watching", () => ({
  getContinueWatching: h.getContinueWatching,
}));

// The visibility query, faked down to its shape: the WHERE is recorded, the
// answer is the case's `visible` slugs among those asked about.
vi.mock("@/db", () => ({
  db: {
    select: () => {
      h.selects += 1;
      return {
        from: () => ({
          where: async (clause: unknown) => {
            h.where = clause;
            const asked = (clause as Array<{ inArray?: string[] }>).find((c) => c?.inArray)?.inArray ?? [];
            return asked
              .filter((slug) => h.visible === null || h.visible.includes(slug))
              .map((slug) => ({ slug }));
          },
        }),
      };
    },
  },
}));
vi.mock("@/db/schema", () => ({ shows: { slug: "shows.slug" } }));
vi.mock("drizzle-orm", () => ({
  and: (...clauses: unknown[]) => clauses,
  inArray: (_column: unknown, values: string[]) => ({ inArray: values }),
}));
// The branching-show exclusion is a correlated subquery built in lib/api/v1;
// its own test proves its shape — here only its PRESENCE in the WHERE matters.
vi.mock("@/lib/api/v1", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/v1")>()),
  linearShowsOnly: () => "linear-shows-only",
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
  h.visible = null;
  h.where = undefined;
  h.selects = 0;
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

  it("drops a tile for a show the app hides — a branching show would be a dead «Up next» card", async () => {
    // Watched before it became branching (or on the web): the web rail keeps
    // it, but /v1/shows/:slug answers 404 for it, as /v1/catalog omits it.
    const branching = {
      ...ITEM,
      show: { ...ITEM.show, slug: "fork-show", title: "Fork Show" },
      episodeId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399",
    };
    h.items = [branching, ITEM];
    h.visible = ["the-scarlet-oath"];

    const body = await (await GET()).json();

    expect(body.items.map((i: { show: { slug: string } }) => i.show.slug)).toEqual(["the-scarlet-oath"]);
    // The SAME predicate as the catalog, over exactly the rail's shows.
    expect(h.where).toContainEqual("linear-shows-only");
    expect(h.where).toContainEqual({ inArray: ["fork-show", "the-scarlet-oath"] });
  });

  it("keeps the server's order among the tiles it keeps", async () => {
    const second = { ...ITEM, show: { ...ITEM.show, slug: "fallen", title: "Fallen" } };
    h.items = [second, ITEM];

    const body = await (await GET()).json();

    expect(body.items.map((i: { show: { slug: string } }) => i.show.slug)).toEqual([
      "fallen",
      "the-scarlet-oath",
    ]);
  });

  it("asks the database nothing more when there is nothing to resume, or nobody to ask for", async () => {
    h.items = [];
    await GET();
    expect(h.selects).toBe(0);

    h.userId = null;
    await GET();
    expect(h.selects).toBe(0);
  });
});
