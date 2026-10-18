import { describe, expect, it } from "vitest";

import { en } from "./dictionaries";

// The visitor-facing entity surface: the footer copyright now carries the
// operating company on every indexed page, and the press boilerplate (the
// "use verbatim" paragraph) names it too — both are load-bearing for #141
// (Google must attribute Matio to DEEP ORDINARY LTD, never a person).

describe("footer copyright names the operating company", () => {
  it("credits DEEP ORDINARY LTD", () => {
    expect(en.footer.copyright(2026)).toBe("© 2026 matio · DEEP ORDINARY LTD");
  });

  it("interpolates the given year", () => {
    expect(en.footer.copyright(2030)).toContain("2030");
  });
});

describe("press boilerplate carries the operator verbatim", () => {
  it("names the company in every variant, and no personal name anywhere", () => {
    for (const text of [en.press.boilerplate, en.press.boilerplateFree]) {
      expect(text).toMatch(/DEEP ORDINARY LTD/);
      expect(text).toMatch(/17381666/);
      expect(text.toLowerCase()).not.toContain("dobrovolski");
    }
  });
});

// #445 (site) + #447 (app): English is the only language left — no second
// dictionary, and no language-switcher copy for a switcher that is gone.
describe("one language", () => {
  it("exports the English dictionary and nothing per-locale", async () => {
    const mod: Record<string, unknown> = await import("./dictionaries");
    expect(Object.keys(mod).sort()).toEqual(["en"]);
  });

  it("carries no language-switcher section", () => {
    expect(en).not.toHaveProperty("language");
  });
});

// #462: paid mode has no free 60-second preview any more — an anonymous
// viewer is asked for an account, then for the membership. The indexed copy
// (meta/OG description, Twitter card, the OG image's tagline, the web
// manifest — which reads siteDescription) must not promise one; the
// payments-off variants keep their own meaning.
describe("paid-mode indexed copy promises no free preview", () => {
  const paid = {
    siteDescription: en.metadata.siteDescription,
    twitterDescription: en.metadata.twitterDescription,
    ogTagline: en.og.tagline,
    synopsisFallback: en.showDetail.synopsisFallback("Fallen", ["Drama"]),
  };

  it.each(Object.entries(paid))("%s says nothing of a free preview", (_key, text) => {
    expect(text).not.toMatch(/60|preview|free/i);
  });

  it("says what it takes: an account, then the membership", () => {
    expect(en.metadata.siteDescription).toBe(
      "Original short-form drama series from the Matio studio. Create an account, then become a member to watch every episode.",
    );
    expect(en.metadata.twitterDescription).toMatch(/account.*member/i);
  });

  it("the payments-off variants are untouched", () => {
    expect(en.metadata.siteDescriptionFree).toMatch(/free/);
    expect(en.og.taglineFree).toBe("Watch everything free.");
  });
});
