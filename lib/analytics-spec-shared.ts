// Universal constants shared by the spec dashboard's server data layer
// (lib/admin-analytics-v2.ts) and its client filter bar — kept out of the
// server-only module so the client bundle can import them.

export const SOURCE_BUCKETS = [
  "tiktok",
  "ig",
  "fb",
  "youtube",
  "direct",
  "other",
] as const;
export type SourceBucket = (typeof SOURCE_BUCKETS)[number];

// Row/option labels. Platform names are brands — not localized; "other" is
// the one bucket with a real translation, so each call site overrides it with
// the admin dict's value.
export const SOURCE_BUCKET_LABELS: Record<SourceBucket, string> = {
  tiktok: "TikTok",
  ig: "Instagram",
  fb: "Facebook",
  youtube: "YouTube",
  direct: "Direct",
  other: "Other",
};
