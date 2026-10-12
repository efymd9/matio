import { describe, expect, it } from "vitest";

import { dictFor, en, es } from "./dictionaries";

// The visitor-facing entity surface: the footer copyright now carries the
// operating company on every indexed page, and the press boilerplate (the
// "use verbatim" paragraph) names it too — both are load-bearing for #141
// (Google must attribute Matio to DEEP ORDINARY LTD, never a person).

describe("footer copyright names the operating company", () => {
  it("credits DEEP ORDINARY LTD on the site and in the app's Spanish", () => {
    expect(en.footer.copyright(2026)).toBe("© 2026 matio · DEEP ORDINARY LTD");
    expect(es.footer.copyright(2026)).toBe("© 2026 matio · DEEP ORDINARY LTD");
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

// #445: the site is English-only; Spanish survives only for the app, and only
// in the sections the app renders.
describe("Spanish is the app's, not the site's", () => {
  it("carries no website-only section", () => {
    for (const section of ["about", "press", "legal", "metadata", "paywall", "subscribe", "checkout", "globalError"]) {
      expect(es, section).not.toHaveProperty(section);
    }
  });

  it("still serves the app both languages, section by section", () => {
    expect(dictFor("en")).toBe(en);
    expect(dictFor("es")).toBe(es);
    expect(es.home.continueWatching).toBe("Continúa viendo");
    expect(en.home.continueWatching).toBe("Continue watching");
  });
});
