import { describe, expect, it } from "vitest";
import type { LicensingTitle } from "./licensing";
import { buildLicensingCards, formatEpisodeStats, type CatalogShow } from "./show-facts";

describe("formatEpisodeStats", () => {
  it("states the count and the rounded run-time range", () => {
    // The Scarlet Oath on 14.11.2026: 9 listed episodes, 559 s … 1420 s.
    expect(formatEpisodeStats({ count: 9, minSeconds: 559, maxSeconds: 1420 })).toBe(
      "9 episodes · 9–24 min",
    );
  });

  it("collapses a range that rounds to one minute, and says 'episode' for one", () => {
    expect(formatEpisodeStats({ count: 1, minSeconds: 891, maxSeconds: 900 })).toBe(
      "1 episode · 15 min",
    );
  });

  it("drops the minutes when no duration is known, and says nothing for zero episodes", () => {
    expect(formatEpisodeStats({ count: 3, minSeconds: null, maxSeconds: null })).toBe("3 episodes");
    expect(formatEpisodeStats({ count: 0, minSeconds: null, maxSeconds: null })).toBeNull();
  });
});

describe("buildLicensingCards", () => {
  const show = (slug: string, over: Partial<CatalogShow> = {}): CatalogShow => ({
    id: `id-${slug}`,
    slug,
    title: slug.toUpperCase(),
    description: ` A logline for ${slug}. `,
    genre: ["dark Romance", "Gothic", "dark romance"],
    posterImageUrl: null,
    heroImageUrl: `/shows/${slug}-hero.jpg`,
    ...over,
  });
  const titles: LicensingTitle[] = [
    { slug: "b", languages: ["English"], format: "Series · 16:9", trailerUrl: "https://youtu.be/x" },
    { slug: "gone", languages: [], format: "" },
    { slug: "a", languages: ["Spanish"], format: "Film", trailerUrl: "javascript:alert(1)" },
  ];

  it("follows the licensing list's order, skips an unpublished slug and invents nothing", () => {
    const cards = buildLicensingCards(
      titles,
      [show("a"), show("b"), show("not-listed")],
      new Map([["id-b", { count: 8, minSeconds: 540, maxSeconds: 1140 }]]),
    );
    expect(cards.map((c) => c.slug)).toEqual(["b", "a"]);
    expect(cards[0]).toEqual({
      slug: "b",
      title: "B",
      logline: "A logline for b.",
      genres: ["dark Romance", "Gothic"],
      episodes: "8 episodes · 9–19 min",
      languages: ["English"],
      format: "Series · 16:9",
      trailerUrl: "https://youtu.be/x",
      posterImageUrl: "/shows/b-hero.jpg",
    });
    // No ready episode → no episode line; a non-http trailer is never drawn.
    expect(cards[1].episodes).toBeNull();
    expect(cards[1].trailerUrl).toBeNull();
  });
});
