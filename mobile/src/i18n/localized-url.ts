import { APP_EMBED_PARAM, APP_EMBED_VALUE } from "@/shared/app-embed";
import type { Locale } from "@/shared/i18n";
import { localizedPath } from "@/shared/seo";

// A matio.tv page in the language chosen in the app. The site serves Spanish
// under /es and English bare (lib/seo.ts — the same rule its own language
// switcher follows), so /v1/config's bare legal URLs read as English to a
// viewer who picked Español on an English phone. The query and fragment stay
// where they were, after the path. Anything that is not an absolute http(s)
// URL is returned untouched.
export function localizedUrl(url: string, locale: Locale): string {
  const match = /^(https?:\/\/[^/?#]+)([^?#]*)(.*)$/.exec(url);
  if (!match) return url;
  const [, origin, path, suffix] = match;
  return `${origin}${localizedPath(path || "/", locale)}${suffix}`;
}

// A legal document as Settings opens it (#310): in the chosen language, and as
// the site's embed variant — the document alone, with no site header (its
// Subscribe link is a purchase outside the App Store) and no trackers. The
// embed URL's path is authoritative for its language (proxy.ts), so English
// picked on a Spanish phone stays English. /v1/config already sends the embed
// URLs; the parameter is added here too so this build does not depend on
// the server for it, and never twice.
export function legalUrl(url: string, locale: Locale): string {
  const localized = localizedUrl(url, locale);
  const match = /^(https?:\/\/[^?#]+)(\?[^#]*)?(#.*)?$/.exec(localized);
  if (!match) return localized;
  const [, base, query = "", hash = ""] = match;
  const pair = `${APP_EMBED_PARAM}=${APP_EMBED_VALUE}`;
  if (query.slice(1).split("&").includes(pair)) return localized;
  return `${base}${query.length > 1 ? `${query}&` : "?"}${pair}${hash}`;
}
