// Unit tests for lib/seo.ts — the canonical URL rule every indexed page reads,
// and what is left of the retired /es prefix (#445): the split proxy.ts reads
// to 308 an /es URL to its bare English path. The prefixing the Expo app used
// to apply to its legal links went with the app's Spanish (#447).

import { describe, expect, it } from "vitest";

import { canonicalUrl, stripLocalePrefix } from "./seo";

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
