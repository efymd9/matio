// Unit tests for lib/seo.ts — the canonical URL rule every indexed page reads,
// and what is left of the retired /es prefix (#445): the split proxy.ts reads
// to 308 an /es URL to its bare English path, and the prefixing the Expo app
// still applies to its legal links.

import { describe, expect, it } from "vitest";

import { canonicalUrl, localizedPath, stripLocalePrefix } from "./seo";

describe("canonicalUrl", () => {
  it("is the bare apex for the home page and apex + path elsewhere", () => {
    expect(canonicalUrl("/")).toBe("https://matio.tv");
    expect(canonicalUrl("")).toBe("https://matio.tv");
    expect(canonicalUrl("/shows/x")).toBe("https://matio.tv/shows/x");
    expect(canonicalUrl("about")).toBe("https://matio.tv/about");
  });
});

describe("stripLocalePrefix", () => {
  it("splits an incoming pathname into locale + base path", () => {
    expect(stripLocalePrefix("/")).toEqual({ locale: "en", path: "/" });
    expect(stripLocalePrefix("/shows/x")).toEqual({
      locale: "en",
      path: "/shows/x",
    });
    expect(stripLocalePrefix("/es")).toEqual({ locale: "es", path: "/" });
    expect(stripLocalePrefix("/es/")).toEqual({ locale: "es", path: "/" });
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

describe("localizedPath (the app's legal links)", () => {
  it("is the identity for English and prefixes Spanish", () => {
    expect(localizedPath("/", "en")).toBe("/");
    expect(localizedPath("/", "es")).toBe("/es");
    expect(localizedPath("/terms", "en")).toBe("/terms");
    expect(localizedPath("/terms", "es")).toBe("/es/terms");
  });

  it("round-trips through the split proxy.ts redirects with", () => {
    for (const path of ["/", "/terms", "/shows/x"]) {
      expect(stripLocalePrefix(localizedPath(path, "es")).path).toBe(path);
    }
  });
});
