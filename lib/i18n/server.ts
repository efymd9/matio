import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  dictFor,
  type Dict,
  type Locale,
} from "./dictionaries";
import { negotiateLocale } from "./negotiate";
import { LOCALE_COOKIE_NAME } from "./shared";

// Re-exported under its historical name so server-side callers don't break.
export const LOCALE_COOKIE = LOCALE_COOKIE_NAME;

// Resolve the locale for this request. An explicit choice (the `locale`
// cookie the language switcher writes) always wins; with no cookie we
// negotiate from Accept-Language with an x-vercel-ip-country tiebreak
// (lib/i18n/negotiate.ts — nothing is persisted, so a changed browser
// language re-detects on the next visit). Crawlers send no Accept-Language
// and keep getting Spanish, same as before detection existed.
//
// Wrapped in React cache() so layout generateMetadata + RootLayout + every
// page's getDict() share one resolution per request instead of re-parsing
// the header per RSC segment. headers() is request-scoped like the
// cookies() call that was always here, so this stays exactly as dynamic as
// before — but it still must never be called inside an unstable_cache /
// "use cache" scope (it would throw; no current caller does).
export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (value && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as Locale;
  }
  try {
    const h = await headers();
    return negotiateLocale(
      h.get("accept-language"),
      h.get("x-vercel-ip-country"),
    );
  } catch {
    // Never let locale resolution take down a render — a throw here would
    // white-screen every page via global-error. Worst case: default copy.
    return DEFAULT_LOCALE;
  }
});

// Convenience: read locale + return the matching dictionary in one call.
// Server components and route handlers use this when they need to render
// translated copy directly without going through the React context.
export async function getDict(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getLocale();
  return { locale, t: dictFor(locale) };
}
