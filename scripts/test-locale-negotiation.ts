// Unit tests for lib/i18n/negotiate.ts — the Accept-Language + geo locale
// negotiation that getLocale() runs for cookie-less visitors. Pure
// functions, no env/DB needed. Run: pnpm test:locale
//
// The cases encode the design decisions, not just the parser mechanics:
// crawlers (no Accept-Language) get the English default — since 2026-07-04
// English IS the site's indexed language; q=0 means "not acceptable"; `*`
// falls through to geo; BR/PT count as Spanish-affinity geos and an es
// Accept-Language always negotiates to Spanish.

import { strict as assert } from "node:assert";
import {
  localeFromCountry,
  negotiateLocale,
  parseAcceptLanguage,
  pickFromLanguageTags,
} from "../lib/i18n/negotiate";
import {
  isLocalizablePath,
  localeAlternates,
  localizedPath,
  stripLocalePrefix,
} from "../lib/seo";

let passed = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  assert.equal(actual, expected, label);
  passed++;
}

// --- parseAcceptLanguage: plain matching --------------------------------
eq(parseAcceptLanguage("es-ES,es;q=0.9,en;q=0.8"), "es", "es region chain");
eq(parseAcceptLanguage("en-US,en;q=0.9,es;q=0.8"), "en", "en region chain");
eq(parseAcceptLanguage("en-GB,en;q=0.9"), "en", "en-GB base match");
eq(parseAcceptLanguage("es-419"), "es", "es-419 base match");
eq(parseAcceptLanguage("EN-gb"), "en", "case-insensitive");
eq(parseAcceptLanguage("es_AR"), "es", "underscore separator");
eq(parseAcceptLanguage("fr-FR,de;q=0.8"), null, "no supported language");
eq(parseAcceptLanguage("pt-BR,pt;q=0.9"), null, "pt alone matches nothing");

// --- q-value semantics ---------------------------------------------------
eq(parseAcceptLanguage("es;q=0.8,en"), "en", "absent q defaults to 1");
eq(parseAcceptLanguage("en;q=0,es;q=0.5"), "es", "q=0 excluded");
eq(parseAcceptLanguage("en;q=0"), null, "q=0 only -> no match");
eq(parseAcceptLanguage("en;q=banana,es;q=0.5"), "en", "malformed q -> 1");
eq(parseAcceptLanguage("es,en;q=50"), "es", "q>1 clamps to 1, first q=1 wins");
eq(parseAcceptLanguage("es,en;q=Infinity"), "es", "q=Infinity clamps to 1");
eq(parseAcceptLanguage("es,en"), "es", "tie keeps header order");
eq(parseAcceptLanguage("en,es"), "en", "tie keeps header order (rev)");
eq(parseAcceptLanguage("fr,es;q=0.9,en;q=0.8"), "es", "skip unsupported leader");
eq(parseAcceptLanguage("en; q=0.7, es; q=0.9"), "es", "spaces around params");

// --- wildcard + garbage --------------------------------------------------
eq(parseAcceptLanguage("*"), null, "bare * matches nothing here");
eq(parseAcceptLanguage("*;q=0.5,fr"), null, "* never counts as a match");
eq(parseAcceptLanguage(""), null, "empty header");
eq(parseAcceptLanguage(null), null, "null header");
eq(parseAcceptLanguage(";;;,,,"), null, "garbage header");
eq(parseAcceptLanguage("es-"), "es", "trailing dash still matches base");

// Hostile size: entries past the cap are discarded, and parsing a multi-KB
// header must not blow up. ("en" hidden at position 50 is ignored.)
{
  const hostile = Array.from({ length: 49 }, (_, i) => `x${i};q=0.9`).join(",") + ",en";
  const t0 = Date.now();
  eq(parseAcceptLanguage(hostile), null, "entry cap discards smuggled tail");
  eq(parseAcceptLanguage("zz,".repeat(50_000) + "en") === null, true, "100KB header bounded");
  assert.ok(Date.now() - t0 < 1_000, "hostile headers parse in bounded time");
  passed++;
}

// --- localeFromCountry ---------------------------------------------------
eq(localeFromCountry("ES"), "es", "Spain");
eq(localeFromCountry("mx"), "es", "Mexico lowercase");
eq(localeFromCountry("BR"), "es", "Brazil -> es affinity");
eq(localeFromCountry("PT"), "es", "Portugal -> es affinity");
eq(localeFromCountry("US"), "en", "US -> en");
eq(localeFromCountry("DE"), "en", "Germany -> en");
eq(localeFromCountry(""), null, "empty country");
eq(localeFromCountry(null), null, "null country");
eq(localeFromCountry("XX1"), null, "malformed country");

// --- negotiateLocale: the full ladder ------------------------------------
// 1. No header at all -> default en, geo NEVER consulted (Googlebot crawls
//    from US IPs with no Accept-Language; the default here IS the site's
//    indexed language — English since the 2026-07-04 flip).
eq(negotiateLocale(null, "US"), "en", "crawler: no header + US geo -> en");
eq(negotiateLocale(null, "ES"), "en", "crawler: no header ignores es geo");
eq(negotiateLocale("", "DE"), "en", "empty header ignores geo");
eq(negotiateLocale("   ", "GB"), "en", "blank header ignores geo");

// 2. Header names a supported language -> it wins, geo irrelevant. This is
//    the arm that keeps Spanish for Spanish-preferring browsers.
eq(negotiateLocale("en-US,en;q=0.9", "ES"), "en", "header beats geo");
eq(negotiateLocale("es-MX", "US"), "es", "header beats geo (rev)");

// 3. Header present but unsupported -> geo tiebreak -> default.
eq(negotiateLocale("fr-FR,fr;q=0.9", "FR"), "en", "French visitor -> en");
eq(negotiateLocale("pt-BR", "BR"), "es", "Brazilian visitor -> es");
eq(negotiateLocale("fr-FR", "MX"), "es", "es-affinity geo still wins es");
eq(negotiateLocale("de-DE", null), "en", "unsupported + no geo -> default");
eq(negotiateLocale("*", "US"), "en", "bare * + US -> en via geo");
eq(negotiateLocale("*", "AR"), "es", "bare * + AR -> es via geo");
eq(negotiateLocale("*", null), "en", "bare * + no geo -> default");

// --- pickFromLanguageTags (global-error's navigator.languages path) ------
eq(pickFromLanguageTags(["fr-FR", "en-GB", "es"]), "en", "first supported wins");
eq(pickFromLanguageTags(["pt-BR"]), null, "no supported tag");
eq(pickFromLanguageTags([]), null, "empty list");
eq(
  pickFromLanguageTags([null, 42, "en-US"] as unknown as string[]),
  "en",
  "non-string entries skipped, never throw (last-resort error boundary)",
);

// --- bilingual URL scheme (lib/seo.ts) -----------------------------------
// stripLocalePrefix: split an incoming pathname into { locale, base path }.
eq(stripLocalePrefix("/").locale, "en", "bare / -> en");
eq(stripLocalePrefix("/").path, "/", "bare / base path");
eq(stripLocalePrefix("/shows/x").locale, "en", "bare show -> en");
eq(stripLocalePrefix("/es").locale, "es", "/es -> es");
eq(stripLocalePrefix("/es").path, "/", "/es base path is home");
eq(stripLocalePrefix("/es/shows/x").locale, "es", "/es/shows -> es");
eq(stripLocalePrefix("/es/shows/x").path, "/shows/x", "/es/shows base path");
eq(stripLocalePrefix("/espanol").locale, "en", "/espanol is NOT an es prefix");
eq(stripLocalePrefix("/espanol").path, "/espanol", "/espanol untouched");

// localizedPath: prefix a base path with the locale segment (en = identity).
eq(localizedPath("/", "en"), "/", "en home identity");
eq(localizedPath("/", "es"), "/es", "es home -> /es");
eq(localizedPath("/shows/x", "en"), "/shows/x", "en show identity");
eq(localizedPath("/shows/x", "es"), "/es/shows/x", "es show prefixed");

// isLocalizablePath: only the indexable public set gets an /es twin. A crafted
// /es/admin must NOT match (its stripped base is /admin) so it never rewrites
// onto the gated route.
eq(isLocalizablePath("/"), true, "home localizable");
eq(isLocalizablePath("/about"), true, "about localizable");
eq(isLocalizablePath("/shows/x"), true, "show localizable");
eq(isLocalizablePath("/actors/y"), true, "actor localizable");
eq(isLocalizablePath("/terms"), true, "terms localizable");
eq(isLocalizablePath("/admin"), false, "admin NOT localizable");
eq(isLocalizablePath("/watch/x"), false, "watch NOT localizable");
eq(isLocalizablePath("/api/t"), false, "api NOT localizable");
eq(isLocalizablePath("/subscribe"), false, "subscribe NOT localizable");
eq(
  isLocalizablePath(stripLocalePrefix("/es/admin").path),
  false,
  "/es/admin strips to /admin, not localizable (no gate bypass)",
);

// localeAlternates: reciprocal hreflang cluster; the page self-canonicalises.
{
  const en = localeAlternates("/shows/x", "en");
  eq(en.canonical, "https://matio.tv/shows/x", "en show self-canonical");
  eq(en.languages.en, "https://matio.tv/shows/x", "hreflang en");
  eq(en.languages.es, "https://matio.tv/es/shows/x", "hreflang es");
  eq(en.languages["x-default"], "https://matio.tv/shows/x", "x-default = en");
  const es = localeAlternates("/shows/x", "es");
  eq(es.canonical, "https://matio.tv/es/shows/x", "es show self-canonical");
  eq(es.languages["x-default"], "https://matio.tv/shows/x", "es x-default = en");
  const home = localeAlternates("/", "es");
  eq(home.canonical, "https://matio.tv/es", "es home self-canonical");
  eq(home.languages.en, "https://matio.tv", "home hreflang en = apex");
}

console.log(`locale-negotiation: ${passed} assertions passed`);
