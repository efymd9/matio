// Unit tests for lib/i18n/negotiate.ts — the language-tag matching behind the
// Expo app's device-language detection (mobile/src/i18n/locale.tsx). Pure
// functions, no env/DB needed.
//
// The website's Accept-Language negotiation (parseAcceptLanguage /
// negotiateLocale) was removed with Spanish on the site (#445); its cases went
// with it. What remains is the tag matching the app still runs on its device
// tags.

import { describe, expect, it } from "vitest";

import { matchSupportedTag, pickFromLanguageTags } from "./negotiate";

describe("matchSupportedTag", () => {
  it("matches by the primary subtag, case- and separator-insensitive", () => {
    expect(matchSupportedTag("es-ES")).toBe("es");
    expect(matchSupportedTag("es-419")).toBe("es");
    expect(matchSupportedTag("es_AR")).toBe("es");
    expect(matchSupportedTag("es-")).toBe("es");
    expect(matchSupportedTag("EN-gb")).toBe("en");
    expect(matchSupportedTag(" en_US ")).toBe("en");
  });

  it("answers null for a language the app does not speak", () => {
    expect(matchSupportedTag("fr-FR")).toBeNull();
    expect(matchSupportedTag("pt-BR")).toBeNull();
    expect(matchSupportedTag("*")).toBeNull();
    expect(matchSupportedTag("")).toBeNull();
  });
});

describe("pickFromLanguageTags", () => {
  it("takes the first supported tag from an ordered list", () => {
    expect(pickFromLanguageTags(["fr-FR", "en-GB", "es"])).toBe("en");
    expect(pickFromLanguageTags(["es_MX", "en"])).toBe("es");
    expect(pickFromLanguageTags(["pt-BR"])).toBeNull();
    expect(pickFromLanguageTags([])).toBeNull();
  });

  it("never throws on non-string entries", () => {
    // The app reads native constants and the runtime's Intl here; a throw
    // would hold the splash instead of falling back to English.
    expect(
      pickFromLanguageTags([null, 42, "en-US"] as unknown as string[]),
    ).toBe("en");
  });
});
