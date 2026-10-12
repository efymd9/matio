import "server-only";

import { en, type Dict } from "./dictionaries";

// The website speaks one language — English — since #445 (2026-10-12): no
// /es URLs (proxy.ts 308s them to the bare path), no Accept-Language
// negotiation, no `locale` cookie, no switcher. These two stay as the one
// place a server component, a route handler or a server action asks "which
// language?", so the answer cannot drift between callers. Spanish lives on
// only in the Expo app (lib/i18n/dictionaries.ts → `es`).
export const SITE_LOCALE = "en" as const;

export async function getLocale(): Promise<typeof SITE_LOCALE> {
  return SITE_LOCALE;
}

// Locale + the matching dictionary in one call — what server components and
// route handlers use to render copy directly.
export async function getDict(): Promise<{
  locale: typeof SITE_LOCALE;
  t: Dict;
}> {
  return { locale: SITE_LOCALE, t: en };
}
