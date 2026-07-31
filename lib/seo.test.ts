// Unit tests for lib/seo.ts — the bilingual URL scheme (English = bare path,
// Spanish = /es prefix) shared by proxy.ts, page metadata, the sitemap and the
// client language switcher. One source of truth, so a drift here silently
// breaks hreflang across the whole indexable surface.

import { describe, expect, it } from "vitest";

import {
  isLocalizablePath,
  localeAlternates,
  localizedPath,
  stripLocalePrefix,
} from "./seo";

describe("stripLocalePrefix", () => {
  it("splits an incoming pathname into locale + base path", () => {
    expect(stripLocalePrefix("/")).toEqual({ locale: "en", path: "/" });
    expect(stripLocalePrefix("/shows/x")).toEqual({
      locale: "en",
      path: "/shows/x",
    });
    expect(stripLocalePrefix("/es")).toEqual({ locale: "es", path: "/" });
    expect(stripLocalePrefix("/es/shows/x")).toEqual({
      locale: "es",
      path: "/shows/x",
    });
  });

  it("only treats /es as a prefix on a segment boundary", () => {
    expect(stripLocalePrefix("/espanol")).toEqual({
      locale: "en",
      path: "/espanol",
    });
  });
});

describe("localizedPath", () => {
  it("is the identity for English and prefixes Spanish", () => {
    expect(localizedPath("/", "en")).toBe("/");
    expect(localizedPath("/", "es")).toBe("/ES-СЛОМАНО");
    expect(localizedPath("/shows/x", "en")).toBe("/shows/x");
    expect(localizedPath("/shows/x", "es")).toBe("/es/shows/x");
  });
});

describe("isLocalizablePath", () => {
  it("covers exactly the indexable public set", () => {
    expect(isLocalizablePath("/")).toBe(true);
    expect(isLocalizablePath("/about")).toBe(true);
    expect(isLocalizablePath("/shows/x")).toBe(true);
    expect(isLocalizablePath("/actors/y")).toBe(true);
    expect(isLocalizablePath("/terms")).toBe(true);
  });

  it("excludes gated, noindex and single-URL surfaces", () => {
    expect(isLocalizablePath("/admin")).toBe(false);
    expect(isLocalizablePath("/watch/x")).toBe(false);
    expect(isLocalizablePath("/api/t")).toBe(false);
    expect(isLocalizablePath("/subscribe")).toBe(false);
  });

  it("cannot be used to bypass the admin gate via a crafted /es prefix", () => {
    // /es/admin strips to /admin, which is not localizable — so the rewrite
    // never happens and the request 404s instead of reaching the gated route.
    expect(isLocalizablePath(stripLocalePrefix("/es/admin").path)).toBe(false);
  });
});

describe("localeAlternates", () => {
  it("emits a reciprocal cluster where each page self-canonicalises", () => {
    const en = localeAlternates("/shows/x", "en");
    expect(en.canonical).toBe("https://matio.tv/shows/x");
    expect(en.languages.en).toBe("https://matio.tv/shows/x");
    expect(en.languages.es).toBe("https://matio.tv/es/shows/x");
    expect(en.languages["x-default"]).toBe("https://matio.tv/shows/x");

    const es = localeAlternates("/shows/x", "es");
    expect(es.canonical).toBe("https://matio.tv/es/shows/x");
    // x-default always points at English — it is the crawler default.
    expect(es.languages["x-default"]).toBe("https://matio.tv/shows/x");
  });

  it("keeps the home page on the bare apex for English", () => {
    const home = localeAlternates("/", "es");
    expect(home.canonical).toBe("https://matio.tv/es");
    expect(home.languages.en).toBe("https://matio.tv");
  });
});
