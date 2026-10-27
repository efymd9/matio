import { describe, expect, it, vi } from "vitest";

// #445 — the site is English-only, so the sitemap lists each route once, at
// its bare canonical: no /es twin (those now 308) and no hreflang cluster.

vi.mock("@/lib/catalog", () => ({
  getPublishedShows: async () => [
    { slug: "the-scarlet-oath", updatedAt: new Date("2026-09-01T00:00:00Z") },
    { slug: "fallen", updatedAt: null },
  ],
}));
vi.mock("@/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["selectDistinct", "from", "innerJoin", "where"]) chain[m] = () => chain;
  chain.then = (ok: (rows: unknown[]) => unknown) =>
    Promise.resolve([{ slug: "lena", updatedAt: new Date("2026-08-01T00:00:00Z") }]).then(ok);
  return { db: chain };
});

import sitemap from "./sitemap";

describe("sitemap.xml — English only", () => {
  it("lists every route once, at its bare apex URL, with no /es entry and no hreflang", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls).toEqual([
      "https://matio.tv",
      "https://matio.tv/about",
      "https://matio.tv/press",
      "https://matio.tv/ideas",
      "https://matio.tv/careers",
      "https://matio.tv/support",
      "https://matio.tv/shows/the-scarlet-oath",
      "https://matio.tv/shows/fallen",
      "https://matio.tv/actors/lena",
      "https://matio.tv/terms",
      "https://matio.tv/privacy",
      "https://matio.tv/cookies",
    ]);
    for (const e of entries) {
      expect(e.url).not.toMatch(/\/es(?:\/|$)/);
      expect(e).not.toHaveProperty("alternates");
    }
  });

  it("keeps the real lastmod: the newest show for the home page, the show's own otherwise", async () => {
    const entries = await sitemap();
    const byUrl = new Map(entries.map((e) => [e.url, e]));

    expect(byUrl.get("https://matio.tv")?.lastModified).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(byUrl.get("https://matio.tv/shows/fallen")?.lastModified).toEqual(
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(byUrl.get("https://matio.tv/terms")).not.toHaveProperty("lastModified");
  });
});
