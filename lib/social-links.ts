// Official Matio social profiles — the single source of truth consumed by the
// footer icon row, the Organization JSON-LD `sameAs`, and /llms.txt. URLs are
// canonical (share-tracking params like ?_t/igsh/si stripped) so the same
// string appears everywhere; entity-resolution across those surfaces depends
// on byte-identical URLs. Universal module: imported by client components.

export type SocialPlatform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "facebook"
  | "x";

export type SocialProfile = {
  platform: SocialPlatform;
  // Accessible / crawler-facing name. Platform names are proper nouns, so
  // this is deliberately not in the i18n dictionaries.
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
  // Added 2026-08-16 from the owner's About brief (uploads/ABOUT.md in the
  // Claude Design project) alongside the /press launch.
  {
    platform: "x",
    label: "X",
    url: "https://x.com/matiotv",
  },
  {
    platform: "facebook",
    label: "Facebook",
    url: "https://www.facebook.com/profile.php?id=61591721543851",
  },
];

// Footer row (and the about/press contact band): the English TikTok plus the
// shared profiles — the site is English-only since #445, and the row used to
// follow the visitor's language. The Spanish TikTok is still the studio's
// own account, so it stays discoverable to crawlers via ALL_SOCIAL_PROFILES /
// sameAs.
export const FOOTER_SOCIAL_PROFILES: SocialProfile[] = [
  TIKTOK_EN,
  ...SHARED_PROFILES,
];

// Every official profile, for sameAs + llms.txt.
export const ALL_SOCIAL_PROFILES: SocialProfile[] = [
  TIKTOK_ES,
  TIKTOK_EN,
  ...SHARED_PROFILES,
];
