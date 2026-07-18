// Audience-retention bucket granularity — single source of truth, shared by
// the player's client-side tracker (marks buckets on timeupdate), the
// saveWatchSegments server action (validates + increments counters), and
// the db/schema/watch_segments.ts table doc. Universal on purpose: the
// player is a client component and must not pull drizzle-orm through a
// schema import just for one constant.
//
// Ten seconds: on a 9–15-minute episode the rendered retention curve is
// visually indistinguishable from per-second resolution at 1/10th the rows
// (54–90 points per episode).
export const WATCH_SEGMENT_BUCKET_SECONDS = 10;

// Most buckets a single honest flush can carry. Flushes happen every ~20s
// of playback (≤3 new buckets) — the headroom covers a long-backgrounded
// tab accumulating a whole episode (90 buckets at 15min) plus seek noise,
// while still bounding what a forged post can inflate per request.
export const WATCH_SEGMENT_FLUSH_MAX_BUCKETS = 120;
