import { describe, expect, it } from "vitest";

import { en, es } from "./dictionaries";

// The visitor-facing entity surface: the footer copyright now carries the
// operating company on every indexed page, and the press boilerplate (the
// "use verbatim" paragraph) names it too — both are load-bearing for #141
// (Google must attribute Matio to DEEP ORDINARY LTD, never a person).

describe("footer copyright names the operating company", () => {
  it("credits DEEP ORDINARY LTD in both locales", () => {
    expect(en.footer.copyright(2026)).toBe("© 2026 matio · DEEP ORDINARY LTD");
    expect(es.footer.copyright(2026)).toBe("© 2026 matio · DEEP ORDINARY LTD");
  });

  it("interpolates the given year", () => {
    expect(en.footer.copyright(2030)).toContain("2030");
  });
});

describe("press boilerplate carries the operator verbatim", () => {
  it("names the company in every variant, and no personal name anywhere", () => {
    for (const dict of [en, es]) {
      for (const text of [dict.press.boilerplate, dict.press.boilerplateFree]) {
        expect(text).toMatch(/DEEP ORDINARY LTD/);
        expect(text).toMatch(/17381666/);
        expect(text.toLowerCase()).not.toContain("dobrovolski");
      }
    }
  });
});
