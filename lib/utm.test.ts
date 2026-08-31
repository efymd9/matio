import { describe, expect, it } from "vitest";

import { normalizeUtm, normalizeUtmSource, UTM_SOURCE_ALIASES } from "./utm";

// The single normalization rule behind campaign attribution: the app's
// columns/cookies/Stripe metadata AND PostHog's HogQL breakdown must group
// campaigns identically, so what is asserted here is the byte-level contract.

describe("normalizeUtm", () => {
  it("kills case drift and stray junk without touching the valid core", () => {
    expect(normalizeUtm("TikTok")).toBe("tiktok");
    expect(normalizeUtm("  summer_launch \n")).toBe("summer_launch");
    // A leaked ">" from a malformed ad link must not fork the campaign.
    expect(normalizeUtm("campaign_1>")).toBe("campaign_1");
    expect(normalizeUtm("camp%20aign")).toBe("camp20aign");
  });

  it("passes numeric Meta {{campaign.id}} values through unchanged", () => {
    expect(normalizeUtm("120211234567890123")).toBe("120211234567890123");
  });

  it("returns undefined for empty and junk-only values", () => {
    expect(normalizeUtm(null)).toBeUndefined();
    expect(normalizeUtm(undefined)).toBeUndefined();
    expect(normalizeUtm("")).toBeUndefined();
    expect(normalizeUtm("   ")).toBeUndefined();
    expect(normalizeUtm("©®™")).toBeUndefined();
  });
});

describe("normalizeUtmSource", () => {
  it("collapses platform spelling variants into one canonical source", () => {
    expect(normalizeUtmSource("Facebook")).toBe("fb");
    expect(normalizeUtmSource("meta")).toBe("fb");
    expect(normalizeUtmSource("Instagram")).toBe("ig");
    // "youtube" is canonical (the /admin/links preset value) — "yt" folds in.
    expect(normalizeUtmSource("yt")).toBe("youtube");
    expect(normalizeUtmSource("youtube")).toBe("youtube");
  });

  it("leaves unknown sources at their normalized value", () => {
    expect(normalizeUtmSource("TikTok")).toBe("tiktok");
    expect(normalizeUtmSource(null)).toBeUndefined();
  });

  it("aliases only ever map to values that need no further aliasing", () => {
    // A chained alias (a → b → c) would make app and HogQL disagree, because
    // the HogQL transform applies the table exactly once.
    for (const target of Object.values(UTM_SOURCE_ALIASES)) {
      expect(UTM_SOURCE_ALIASES[target]).toBeUndefined();
    }
  });
});
