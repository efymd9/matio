// Unit tests for lib/i18n/negotiate.ts — the Accept-Language + geo locale
// negotiation that getLocale() runs for cookie-less visitors. Pure functions,
// no env/DB needed.
//
// The cases encode the design decisions, not just the parser mechanics:
// crawlers (no Accept-Language) get the English default — since 2026-07-04
// English IS the site's indexed language; q=0 means "not acceptable"; `*`
// falls through to geo; BR/PT count as Spanish-affinity geos and an es
// Accept-Language always negotiates to Spanish.

import { describe, expect, it } from "vitest";

import {
  negotiateLocale,
  parseAcceptLanguage,
  pickFromLanguageTags,
} from "./negotiate";

describe("parseAcceptLanguage", () => {
  it("matches a supported language through region chains", () => {
    expect(parseAcceptLanguage("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
    expect(parseAcceptLanguage("en-US,en;q=0.9,es;q=0.8")).toBe("en");
    expect(parseAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(parseAcceptLanguage("es-419")).toBe("es");
    expect(parseAcceptLanguage("EN-gb")).toBe("en");
    expect(parseAcceptLanguage("es_AR")).toBe("es");
    expect(parseAcceptLanguage("es-")).toBe("es");
  });

  it("returns null when nothing supported is offered", () => {
    expect(parseAcceptLanguage("fr-FR,de;q=0.8")).toBeNull();
    expect(parseAcceptLanguage("pt-BR,pt;q=0.9")).toBeNull();
  });

  it("applies q-value semantics", () => {
    expect(parseAcceptLanguage("es;q=0.8,en")).toBe("en"); // absent q = 1
    expect(parseAcceptLanguage("en;q=0,es;q=0.5")).toBe("es"); // q=0 excluded
    expect(parseAcceptLanguage("en;q=0")).toBeNull();
    expect(parseAcceptLanguage("en;q=banana,es;q=0.5")).toBe("en"); // malformed q = 1
    expect(parseAcceptLanguage("es,en;q=50")).toBe("es"); // q>1 clamps
    expect(parseAcceptLanguage("es,en;q=Infinity")).toBe("es");
    expect(parseAcceptLanguage("es,en")).toBe("es"); // tie keeps header order
    expect(parseAcceptLanguage("en,es")).toBe("en");
    expect(parseAcceptLanguage("fr,es;q=0.9,en;q=0.8")).toBe("es");
    expect(parseAcceptLanguage("en; q=0.7, es; q=0.9")).toBe("es");
  });

  it("treats a wildcard as no match, and survives garbage", () => {
    expect(parseAcceptLanguage("*")).toBeNull();
    expect(parseAcceptLanguage("*;q=0.5,fr")).toBeNull();
    expect(parseAcceptLanguage("")).toBeNull();
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage(";;;,,,")).toBeNull();
  });

  it("bounds hostile headers: entries past the cap are discarded", () => {
    // "en" hidden at position 50 must be ignored, and a multi-KB header must
    // parse in bounded time rather than blowing up the request.
    const smuggled =
      Array.from({ length: 49 }, (_, i) => `x${i};q=0.9`).join(",") + ",en";
    const started = Date.now();

    expect(parseAcceptLanguage(smuggled)).toBeNull();
    expect(parseAcceptLanguage("zz,".repeat(50_000) + "en")).toBeNull();

    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("negotiateLocale", () => {
  it("defaults to English when there is no Accept-Language header", () => {
    // Googlebot crawls from US IPs and sends no Accept-Language: the default
    // here IS the site's indexed language.
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
    expect(negotiateLocale("   ")).toBe("en");
  });

  it("honours an explicit supported language", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
    expect(negotiateLocale("es-MX")).toBe("es");
    expect(negotiateLocale("es;q=0.8,en;q=0.9")).toBe("en");
  });

  it("gives English to every unmatched header — geo is never consulted", () => {
    // The 2026-08-31 owner decision: a ru/de/fr/pt browser gets English
    // everywhere, including in Spain and Latin America. Spanish is explicit
    // signals only (header, switcher cookie, /es URL). This is what stops a
    // Russian-language browser in Madrid from being pinned to Spanish.
    expect(negotiateLocale("ru-RU,ru;q=0.9")).toBe("en");
    expect(negotiateLocale("fr-FR,fr;q=0.9")).toBe("en");
    expect(negotiateLocale("pt-BR")).toBe("en");
    expect(negotiateLocale("de-DE")).toBe("en");
    expect(negotiateLocale("*")).toBe("en");
  });
});

describe("pickFromLanguageTags", () => {
  it("takes the first supported tag from navigator.languages", () => {
    expect(pickFromLanguageTags(["fr-FR", "en-GB", "es"])).toBe("en");
    expect(pickFromLanguageTags(["pt-BR"])).toBeNull();
    expect(pickFromLanguageTags([])).toBeNull();
  });

  it("never throws on non-string entries", () => {
    // This runs inside global-error.tsx — the last-resort error boundary. A
    // throw here would replace one broken page with a blank one.
    expect(
      pickFromLanguageTags([null, 42, "en-US"] as unknown as string[]),
    ).toBe("en");
  });
});
