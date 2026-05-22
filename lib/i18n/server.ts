import "server-only";

import { cookies } from "next/headers";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  dictFor,
  type Dict,
  type Locale,
} from "./dictionaries";
import { LOCALE_COOKIE_NAME } from "./shared";

// Re-exported under its historical name so server-side callers don't break.
export const LOCALE_COOKIE = LOCALE_COOKIE_NAME;

// Read the user's selected locale from the cookie. Falls back to Spanish
// (the site's default locale). Used by the root layout to set <html lang>
// and to seed the LocaleProvider for client components.
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (value && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return DEFAULT_LOCALE;
}

// Convenience: read locale + return the matching dictionary in one call.
// Server components and route handlers use this when they need to render
// translated copy directly without going through the React context.
export async function getDict(): Promise<{ locale: Locale; t: Dict }> {
  const locale = await getLocale();
  return { locale, t: dictFor(locale) };
}
