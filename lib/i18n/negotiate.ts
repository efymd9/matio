// Preferred-locale negotiation from request signals. Pure + universal (no
// next/headers, no "server-only") so the same matching rules serve three
// callers: getLocale() on the server (Accept-Language + geo), the
// global-error boundary on the client (navigator.languages), and the tsx
// test script. Resolution lives in lib/i18n/server.ts — this module only
// answers "given these signals, which supported locale fits best?".
//
// Detection deliberately writes NOTHING (no cookie, no storage): it
// re-derives per request, so it self-heals when the user changes their
// browser language and never needs consent (ePrivacy gates storage/access
// on the device — reading a request header the browser already sent is
// neither). The explicit switcher choice writes the `locale` cookie, which
// getLocale() checks first, so a user's choice always beats detection.

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type Locale,
} from "./dictionaries";

// Countries where Spanish is the best guess for a visitor whose
// Accept-Language matched neither dictionary: Hispanophone countries
// (official/primary language Spanish, incl. Puerto Rico and Equatorial
// Guinea) plus the Lusophone pair BR/PT — a pt-only browser reads the
// Spanish UI far more comfortably than the English one (and English
// proficiency in Brazil is low). Every other *valid* country code falls
// to English as the international default. Judgment call — flip BR/PT out
// of this set if funnel data ever says otherwise.
export const ES_AFFINITY_COUNTRIES = new Set([
  "ES", "MX", "CO", "AR", "PE", "VE", "CL", "GT", "EC", "BO", "CU", "DO",
  "HN", "PY", "SV", "NI", "CR", "PA", "UY", "GQ", "PR",
  "BR", "PT",
]);

// Map a single language tag (es-419, en_GB, EN) to a supported locale by
// its primary subtag, or null. Case-insensitive; tolerates the
// non-standard underscore separator some clients emit.
export function matchSupportedTag(tag: string): Locale | null {
  const base = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base)
    ? (base as Locale)
    : null;
}

// First supported match in an ordered tag list (navigator.languages).
// Skips non-string entries: the sole caller is global-error.tsx — the
// LAST-RESORT boundary, where a throw would leave a blank page — so this
// never trusts the runtime to hand it a clean array.
export function pickFromLanguageTags(
  tags: readonly string[],
): Locale | null {
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const match = matchSupportedTag(tag);
    if (match) return match;
  }
  return null;
}

// How many comma-separated entries we bother parsing. Real browsers send
// well under 10; the cap bounds work on hostile multi-KB headers (and
// String.split's limit discards the tail outright, so an entry smuggled in
// at position 50 is simply never looked at).
const MAX_ACCEPT_LANGUAGE_ENTRIES = 16;

// Minimal RFC 9110 §12.5.4 negotiation against SUPPORTED_LOCALES.
// Rules: absent q defaults to 1; q<=0 means "not acceptable" and is
// excluded; malformed q is treated as 1 (be liberal); `*` is skipped (it
// expresses "anything", which the caller resolves via geo/default, not by
// pretending the client asked for a specific language); ties keep header
// order (strict > comparison = first wins). Returns null when no entry
// matches a supported locale.
export function parseAcceptLanguage(
  header: string | null | undefined,
): Locale | null {
  if (!header) return null;
  let best: Locale | null = null;
  let bestQ = 0;
  for (const entry of header.split(",", MAX_ACCEPT_LANGUAGE_ENTRIES)) {
    const [rawTag, ...params] = entry.split(";");
    const tag = rawTag.trim();
    if (!tag || tag === "*") continue;
    let q = 1;
    for (const param of params) {
      const eq = param.indexOf("=");
      if (eq === -1) continue;
      if (param.slice(0, eq).trim().toLowerCase() !== "q") continue;
      const parsed = Number.parseFloat(param.slice(eq + 1).trim());
      // RFC caps q at 1.000 — clamp instead of trusting a malformed q=50 /
      // q=Infinity, which would otherwise beat a genuine q=1 first choice.
      if (!Number.isNaN(parsed)) q = Math.min(parsed, 1);
    }
    if (q <= 0) continue;
    const match = matchSupportedTag(tag);
    if (match && q > bestQ) {
      best = match;
      bestQ = q;
    }
  }
  return best;
}

// Geo tiebreak from Vercel's `x-vercel-ip-country` (ISO 3166-1 alpha-2).
// Same validation posture as marketingConsentRequired(): anything that
// isn't a clean two-letter code is "unknown" → null (the header is absent
// on localhost and can be junk behind weird proxies).
export function localeFromCountry(
  country: string | null | undefined,
): Locale | null {
  const c = country?.trim().toUpperCase();
  if (!c || !/^[A-Z]{2}$/.test(c)) return null;
  return ES_AFFINITY_COUNTRIES.has(c) ? "es" : "en";
}

// The full ladder for a visitor with no `locale` cookie:
//   1. No Accept-Language at all → DEFAULT_LOCALE. Real browsers always
//      send the header; the no-header population is crawlers (Googlebot
//      crawls from US IPs with NO Accept-Language) — keeping them on the
//      default means the indexed language stays exactly what it was
//      before detection shipped. Geo is deliberately NOT consulted here.
//   2. Header names a supported language → highest-q wins.
//   3. Header exists but matches nothing (fr-FR, de, pt-BR, bare `*`) →
//      geo tiebreak; unknown geo → DEFAULT_LOCALE.
export function negotiateLocale(
  acceptLanguage: string | null | undefined,
  country: string | null | undefined,
): Locale {
  if (!acceptLanguage?.trim()) return DEFAULT_LOCALE;
  return (
    parseAcceptLanguage(acceptLanguage) ??
    localeFromCountry(country) ??
    DEFAULT_LOCALE
  );
}
