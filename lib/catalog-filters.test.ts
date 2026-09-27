import { describe, expect, it } from "vitest";

import {
  filterShows,
  genreChips,
  genreLabel,
  matchesQuery,
  normalizeGenreKey,
  resolveChip,
} from "./catalog-filters";

// The production catalog's genre strings as of 2026-09-19 (#245): nine
// strings, eight distinct once normalised. The chip row the Browse tab draws
// is asserted against exactly this shape.
const PROD_GENRES: string[][] = [
  ["dark Romance", "gothic"],
  ["drama"],
  ["Drama"],
  ["Sci-Fi"],
  ["sci-fi", "thriller"],
  ["romance"],
  ["comedy"],
  ["adventure"],
];

const CATALOG = [
  { title: "The Scarlet Oath", genre: ["dark Romance", "gothic"], orientation: "horizontal" },
  { title: "Quédate conmigo", genre: ["Drama"], orientation: "horizontal" },
  { title: "Fallen", genre: ["drama", "Sci-Fi"], orientation: "horizontal" },
  { title: "Morelli", genre: ["sci-fi"], orientation: "vertical" },
];

describe("normalizeGenreKey", () => {
  it("trims, lower-cases and collapses inner whitespace", () => {
    expect(normalizeGenreKey("dark Romance")).toBe("dark romance");
    expect(normalizeGenreKey("  Dark   romance \n")).toBe("dark romance");
    expect(normalizeGenreKey("Sci-Fi")).toBe("sci-fi");
  });

  it("maps an empty or whitespace-only genre to the empty key", () => {
    expect(normalizeGenreKey("")).toBe("");
    expect(normalizeGenreKey("   ")).toBe("");
  });
});

describe("genreLabel", () => {
  it("capitalises the first letter and nothing else", () => {
    expect(genreLabel("dark romance")).toBe("Dark romance");
    expect(genreLabel("sci-fi")).toBe("Sci-fi");
    expect(genreLabel("")).toBe("");
  });
});

describe("genreChips", () => {
  it("folds the production catalog's nine strings into eight chips, in first-appearance order", () => {
    const chips = genreChips(PROD_GENRES.map((genre) => ({ genre })));
    expect(chips).toHaveLength(8);
    expect(chips.map((c) => c.key)).toEqual([
      "dark romance",
      "gothic",
      "drama",
      "sci-fi",
      "thriller",
      "romance",
      "comedy",
      "adventure",
    ]);
    expect(chips[0]).toEqual({ key: "dark romance", label: "Dark romance" });
  });

  it("gives 'Sci-Fi' and 'sci-fi' one chip", () => {
    const chips = genreChips([{ genre: ["Sci-Fi"] }, { genre: ["sci-fi"] }]);
    expect(chips).toEqual([{ key: "sci-fi", label: "Sci-fi" }]);
  });

  it("drops empty and whitespace-only genres", () => {
    expect(genreChips([{ genre: ["", "  ", "drama"] }])).toEqual([
      { key: "drama", label: "Drama" },
    ]);
  });
});

describe("matchesQuery", () => {
  it("ignores case and diacritics on both sides", () => {
    expect(matchesQuery("QUÉDATE CONMIGO", "quedate")).toBe(true);
    expect(matchesQuery("Quedate conmigo", "QUÉDATE")).toBe(true);
  });

  it("matches a substring anywhere in the title", () => {
    expect(matchesQuery("The Scarlet Oath", "sca")).toBe(true);
    expect(matchesQuery("The Scarlet Oath", "oath")).toBe(true);
    expect(matchesQuery("The Scarlet Oath", "morelli")).toBe(false);
  });

  it("treats an empty or whitespace-only query as 'everything'", () => {
    expect(matchesQuery("Fallen", "")).toBe(true);
    expect(matchesQuery("Fallen", "   ")).toBe(true);
  });
});

describe("filterShows", () => {
  const titles = (rows: { title: string }[]) => rows.map((r) => r.title);

  it("returns the whole catalog for the All chip and an empty query", () => {
    expect(filterShows(CATALOG, { kind: "all" }, "")).toHaveLength(4);
  });

  it("narrows by query alone — 'sca' is one result on the production catalog", () => {
    expect(titles(filterShows(CATALOG, { kind: "all" }, "sca"))).toEqual(["The Scarlet Oath"]);
  });

  it("the Vertical chip keeps only vertical shows — Morelli", () => {
    expect(titles(filterShows(CATALOG, { kind: "vertical" }, ""))).toEqual(["Morelli"]);
  });

  it("a genre chip matches through normalisation ('Drama' and 'drama' are one genre)", () => {
    expect(titles(filterShows(CATALOG, { kind: "genre", key: "drama" }, ""))).toEqual([
      "Quédate conmigo",
      "Fallen",
    ]);
  });

  it("chip AND query: both must hold", () => {
    expect(titles(filterShows(CATALOG, { kind: "genre", key: "sci-fi" }, "fal"))).toEqual([
      "Fallen",
    ]);
    expect(filterShows(CATALOG, { kind: "vertical" }, "fallen")).toEqual([]);
  });
});

describe("resolveChip (#304 item 9)", () => {
  const chips = genreChips(CATALOG);

  it("keeps a selection whose chip is still drawn — the very same object", () => {
    const drama = { kind: "genre", key: "drama" } as const;
    const vertical = { kind: "vertical" } as const;
    const all = { kind: "all" } as const;
    expect(resolveChip(drama, chips, true)).toBe(drama);
    expect(resolveChip(vertical, chips, true)).toBe(vertical);
    expect(resolveChip(all, chips, false)).toBe(all);
  });

  it("a genre that left the catalog falls back to All — and the grid is the whole catalog again", () => {
    // «Drama» renamed to «Drama romántico» by the admin: the old key has no chip.
    const renamed = CATALOG.map((show) => ({
      ...show,
      genre: show.genre.map((g) => (normalizeGenreKey(g) === "drama" ? "Drama romántico" : g)),
    }));
    const active = resolveChip({ kind: "genre", key: "drama" }, genreChips(renamed), true);

    expect(active).toEqual({ kind: "all" });
    expect(filterShows(renamed, active, "")).toHaveLength(4);
  });

  it("the Vertical chip falls back to All once no vertical show is left", () => {
    expect(resolveChip({ kind: "vertical" }, chips, false)).toEqual({ kind: "all" });
  });

  it("the fallback is one stable object, so a memo on the active chip does not churn", () => {
    const first = resolveChip({ kind: "genre", key: "gone" }, chips, true);
    const second = resolveChip({ kind: "vertical" }, chips, false);
    expect(second).toBe(first);
  });
});
