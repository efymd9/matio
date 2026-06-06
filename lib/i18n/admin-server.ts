import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import {
  ADMIN_SUPPORTED_LOCALES,
  DEFAULT_ADMIN_LOCALE,
  adminDictFor,
  type AdminDict,
  type AdminLocale,
} from "./admin-dictionaries";
import { ADMIN_LOCALE_COOKIE_NAME } from "./admin-shared";

// Mirrors the public LOCALE_COOKIE re-export naming (lib/i18n/server.ts).
export const ADMIN_LOCALE_COOKIE = ADMIN_LOCALE_COOKIE_NAME;

// Resolve the admin locale for this request. Russian is the default; the
// only way to land on English is the explicit switcher choice (the
// `admin_locale` cookie). Unlike the public surface there is no
// Accept-Language / geo negotiation — the admin panel is internal and the
// audience is known, so detection would only add moving parts.
//
// Wrapped in React cache() like the public getLocale so the admin layout +
// every nested page share one cookie read per request. Same constraint
// applies: never call inside an unstable_cache / "use cache" scope.
export const getAdminLocale = cache(async (): Promise<AdminLocale> => {
  try {
    const value = (await cookies()).get(ADMIN_LOCALE_COOKIE)?.value;
    if (
      value &&
      (ADMIN_SUPPORTED_LOCALES as readonly string[]).includes(value)
    ) {
      return value as AdminLocale;
    }
  } catch {
    // Never let locale resolution take down an admin render.
  }
  return DEFAULT_ADMIN_LOCALE;
});

// Convenience: read locale + return the matching dictionary in one call.
// Admin server components use this directly; client components go through
// the AdminLocaleProvider context instead.
export async function getAdminDict(): Promise<{
  locale: AdminLocale;
  t: AdminDict;
}> {
  const locale = await getAdminLocale();
  return { locale, t: adminDictFor(locale) };
}
