import type { Locale } from "./i18n/dictionaries";

// Official Matio social profiles — the single source of truth consumed by the
// footer icon row, the Organization JSON-LD `sameAs`, and /llms.txt. URLs are
// canonical (share-tracking params like ?_t/igsh/si stripped) so the same
// string appears everywhere; entity-resolution across those surfaces depends
// on byte-identical URLs. Universal module: imported by client components.

export type SocialPlatform = "tiktok" | "instagram" | "youtube" | "facebook";

export type SocialProfile = {
  platform: SocialPlatform;
  // Accessible / crawler-facing name. Platform names are proper nouns and
  // identical in both site languages, so this is deliberately not in the
  // i18n dictionaries.
  label: string;
  url: string;
};

const TIKTOK_ES: SocialProfile = {
  platform: "tiktok",
  label: "TikTok (Español)",
  url: "https://www.tiktok.com/@matio.tv0",
};

const TIKTOK_EN: SocialProfile = {
  platform: "tiktok",
  label: "TikTok (English)",
  url: "https://www.tiktok.com/@matio_en",
};

const SHARED_PROFILES: SocialProfile[] = [
  {
    platform: "instagram",
    label: "Instagram",
    url: "https://www.instagram.com/matio_tv",
  },
  {
    platform: "youtube",
    label: "YouTube",
    url: "https://www.youtube.com/@matio_tv",
  },
  {
    platform: "facebook",
    label: "Facebook",
    url: "https://www.facebook.com/profile.php?id=61591721543851",
  },
];

// Footer row: one TikTok per language — the account matching the visitor's
// locale — plus the shared profiles. Both TikToks stay discoverable to
// crawlers via ALL_SOCIAL_PROFILES / sameAs.
export function socialProfilesForLocale(locale: Locale): SocialProfile[] {
  return [locale === "es" ? TIKTOK_ES : TIKTOK_EN, ...SHARED_PROFILES];
}

// Every official profile, for sameAs + llms.txt.
export const ALL_SOCIAL_PROFILES: SocialProfile[] = [
  TIKTOK_ES,
  TIKTOK_EN,
  ...SHARED_PROFILES,
];
