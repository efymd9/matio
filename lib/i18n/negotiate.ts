// Language-tag matching for the Expo app's device-language detection
// (mobile/src/i18n/locale.tsx, through mobile/src/shared/i18n.ts). Pure +
// universal — no next/headers, no "server-only" — so Metro can bundle it.
//
// The website used to negotiate its language from Accept-Language here too;
// since #445 (2026-10-12) the site is English-only and asks nothing of the
// request, so what is left is the app's half: "given these tags, which
// supported locale fits best?".

import {
  SUPPORTED_LOCALES,
  type Locale,
} from "./dictionaries";

// Map a single language tag (es-419, en_GB, EN) to a supported locale by
// its primary subtag, or null. Case-insensitive; tolerates the
// non-standard underscore separator some clients emit.
export function matchSupportedTag(tag: string): Locale | null {
  const base = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base)
    ? (base as Locale)
    : null;
}

// First supported match in an ordered tag list (the device's language tags).
// Skips non-string entries: a native constant or a runtime's Intl can hand
// back something unexpected, and a throw here would hold the app's splash,
// so this never trusts its input to be a clean array.
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
