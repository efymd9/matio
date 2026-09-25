import type { Locale } from "@/shared/i18n";
import { localizedPath } from "@/shared/seo";

// A matio.tv page in the language chosen in the app. The site serves Spanish
// under /es and English bare (lib/seo.ts — the same rule its own language
// switcher follows), so /v1/config's bare legal URLs read as English to a
// viewer who picked Español on an English phone. Anything that is not an
// absolute http(s) URL is returned untouched.
//
// Residual, by the site's design: English picked on a SPANISH phone is still
// sent to /es — the in-app browser carries the phone's Accept-Language, and
// the site redirects a Spanish-preferring visitor on a bare URL; there is no
// /en prefix to ask for English explicitly.
export function localizedUrl(url: string, locale: Locale): string {
  const match = /^(https?:\/\/[^/?#]+)(.*)$/.exec(url);
  if (!match) return url;
  const [, origin, rest] = match;
  return `${origin}${localizedPath(rest || "/", locale)}`;
}
