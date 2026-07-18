// Universal constants shared by the spec dashboard's server data layer
// (lib/admin-analytics-v2.ts) and its client filter bar — kept out of the
// server-only module so the client bundle can import them.

export const SOURCE_BUCKETS = [
  "tiktok",
  "ig",
  "fb",
  "direct",
  "other",
] as const;
export type SourceBucket = (typeof SOURCE_BUCKETS)[number];
