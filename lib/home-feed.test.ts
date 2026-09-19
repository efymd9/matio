import { describe, expect, it } from "vitest";

import type { ContinueWatchingEntry, ShowSummary } from "./api/types";
import { buildHomeFeed, type HomeFeedItem } from "./home-feed";

// A catalog shaped like production on 2026-09-19 (#248): eight shows, the
// featured one first as the carousel wants it, seven justReleased, four
// popularNow, one vertical. The flags below are the shape the rules are
// asserted against, not a byte copy of the live rows.
function show(
  slug: string,
  flags: Partial<Pick<ShowSummary, "featured" | "justReleased" | "popularNow" | "orientation">> = {},
): ShowSummary {
  return {
    id: `id-${slug}`,
    slug,
    title: slug,
    synopsis: null,
    genre: ["drama"],
    orientation: "horizontal",
    posterImageUrl: null,
    heroImageUrl: null,
    episodeCount: 1,
    featured: false,
    justReleased: false,
    popularNow: false,
    ...flags,
  };
}

function resumeOf(slug: string, episodeId: string): ContinueWatchingEntry {
  return {
    show: { slug, title: slug, orientation: "horizontal", posterImageUrl: null, heroImageUrl: null },
    episodeId,
    episodeNumber: 2,
    episodeTitle: "ep",
    positionSeconds: 30,
    durationSeconds: 120,
    fraction: 0.25,
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
}

const CATALOG: ShowSummary[] = [
  show("the-scarlet-oath", { featured: true, justReleased: true, popularNow: true }),
  show("fallen", { justReleased: true }),
  show("second-hand", { justReleased: true }),
  show("protocol-1500", { popularNow: true }),
  show("morelli", { justReleased: true, orientation: "vertical" }),
  show("cartero-mundo", { justReleased: true, popularNow: true }),
  show("juego-de-seduccion", { justReleased: true, popularNow: true }),
  show("quedate-conmigo", { justReleased: true }),
];

const RESUME = [resumeOf("quedate-conmigo", "ep-q2"), resumeOf("morelli", "ep-m1")];

// A compact, order-preserving fingerprint of a feed: one token per item.
function outline(items: HomeFeedItem[]): string[] {
  return items.map((item) => {
    switch (item.kind) {
      case "heading":
        return `heading:${item.label}`;
      case "resume":
        return `resume:${item.entry.show.slug}`;
      case "show":
        return `show:${item.show.slug}${item.badge ? `[${item.badge}]` : ""}`;
      case "rail":
        return `rail:${item.shows.map((s) => s.slug).join(",")}`;
    }
  });
}

describe("buildHomeFeed", () => {
  it("gives an anonymous viewer no Up next — and nothing else in its place", () => {
    const items = buildHomeFeed({ shows: CATALOG, resume: RESUME, signedIn: false });
    expect(items.some((i) => i.kind === "resume")).toBe(false);
    expect(items.some((i) => i.kind === "heading" && i.label === "upNext")).toBe(false);
    // The first thing under the caption is Just released, not a sign-up card.
    expect(items[0]).toEqual({ kind: "heading", id: "heading:justReleased", label: "justReleased" });
  });

  it("gives a signed-in viewer the Up next heading and one resume card per entry, in the entries' order", () => {
    const items = buildHomeFeed({ shows: CATALOG, resume: RESUME, signedIn: true });
    expect(outline(items).slice(0, 3)).toEqual([
      "heading:upNext",
      "resume:quedate-conmigo",
      "resume:morelli",
    ]);
    expect(items[1]).toMatchObject({ id: "resume:ep-q2", entry: RESUME[0] });
    expect(items[2]).toMatchObject({ id: "resume:ep-m1", entry: RESUME[1] });
  });

  it("never draws the featured show as a card — it opens the carousel", () => {
    const items = buildHomeFeed({ shows: CATALOG, resume: [], signedIn: false });
    expect(items.some((i) => i.kind === "show" && i.show.slug === "the-scarlet-oath")).toBe(false);
    // …but it still rides the Popular now rail, which excludes nothing.
    const rail = items.find((i) => i.kind === "rail");
    expect(rail && rail.shows.map((s) => s.slug)).toEqual([
      "the-scarlet-oath",
      "protocol-1500",
      "cartero-mundo",
      "juego-de-seduccion",
    ]);
  });

  it("does not repeat a show from Up next as a show card, so no show appears twice", () => {
    const items = buildHomeFeed({ shows: CATALOG, resume: RESUME, signedIn: true });
    const asCards = items.filter((i) => i.kind === "show").map((i) => i.show.slug);
    expect(asCards).not.toContain("quedate-conmigo");
    expect(asCards).not.toContain("morelli");
    const slugs = items.flatMap((i) =>
      i.kind === "show" ? [i.show.slug] : i.kind === "resume" ? [i.entry.show.slug] : [],
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slots the Popular now rail after the second show card", () => {
    const items = buildHomeFeed({ shows: CATALOG, resume: [], signedIn: false });
    expect(outline(items)).toEqual([
      "heading:justReleased",
      "show:fallen[new]",
      "show:second-hand[new]",
      "rail:the-scarlet-oath,protocol-1500,cartero-mundo,juego-de-seduccion",
      "show:morelli[new]",
      "show:cartero-mundo[new]",
      "show:juego-de-seduccion[new]",
      "show:quedate-conmigo[new]",
      "show:protocol-1500",
    ]);
  });

  it("with a single show card, puts the rail right after the Just released block", () => {
    const shows = [
      show("featured", { featured: true, popularNow: true }),
      show("only-new", { justReleased: true }),
    ];
    expect(outline(buildHomeFeed({ shows, resume: [], signedIn: false }))).toEqual([
      "heading:justReleased",
      "show:only-new[new]",
      "rail:featured",
    ]);
    // Signed in, the block sits under Up next; the rail still follows it.
    expect(
      outline(buildHomeFeed({ shows, resume: [resumeOf("featured", "ep-f")], signedIn: true })),
    ).toEqual(["heading:upNext", "resume:featured", "heading:justReleased", "show:only-new[new]", "rail:featured"]);
  });

  it("draws no rail when nothing is popular, and no Just released heading when nothing is new", () => {
    const shows = [show("a"), show("b", { orientation: "vertical" })];
    const items = buildHomeFeed({ shows, resume: [], signedIn: false });
    expect(outline(items)).toEqual(["show:a", "show:b[vertical]"]);
  });

  it("badges a just-released vertical show «new» — one pill per card, new wins", () => {
    const shows = [show("v-new", { justReleased: true, orientation: "vertical" })];
    const [heading, card] = buildHomeFeed({ shows, resume: [], signedIn: false });
    expect(heading).toMatchObject({ kind: "heading", label: "justReleased" });
    expect(card).toMatchObject({ kind: "show", badge: "new", id: "show:id-v-new" });
  });

  it("returns an empty feed for an empty catalog, whatever the viewer has to resume", () => {
    expect(buildHomeFeed({ shows: [], resume: [], signedIn: false })).toEqual([]);
    expect(buildHomeFeed({ shows: [], resume: RESUME, signedIn: true })).toEqual([]);
  });

  it("uses stable ids the list can key on", () => {
    const ids = buildHomeFeed({ shows: CATALOG, resume: RESUME, signedIn: true }).map((i) => i.id);
    expect(ids).toContain("heading:upNext");
    expect(ids).toContain("heading:justReleased");
    expect(ids).toContain("rail:popularNow");
    expect(ids).toContain("show:id-fallen");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
