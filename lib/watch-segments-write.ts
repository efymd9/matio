import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  trialSessions,
  watchProgress,
  watchSegments,
} from "@/db/schema";
import { getOrderedReadyEpisodeIds } from "@/lib/episode-access";
import { paymentsEnabled } from "@/lib/free-mode";
import { hasActiveSubscription } from "@/lib/subscription-access";
import { POSITION_SECONDS_MAX } from "@/lib/watch-progress";
import {
  WATCH_SEGMENT_BUCKET_SECONDS,
  WATCH_SEGMENT_FLUSH_MAX_BUCKETS,
} from "@/lib/watch-segments";

// The audience-retention counter flush, shared by the web's server action
// (app/watch/actions.ts:saveWatchSegments) and the app's
// POST /api/v1/watch-segments — the same split lib/watch-progress.ts made
// for progress saves. One implementation on purpose: the bucket bound, the
// dedupe, the per-(episode, day, bucket) increment, the session-row proof
// for anonymous callers and the signed-in watched-seconds credit are what
// the admin retention curve reads, and two copies would drift exactly where
// nobody looks.
//
// Idempotent in the sense the codebase promises for mutations: the counter
// row is keyed on its natural (episode_id, day, bucket) and written with
// ON CONFLICT DO UPDATE, so a retried flush can never create a second row;
// the signed-in credit is UPDATE-only and never inserts. A retry after a
// LOST response does increment the counter again — accepted, as on the web:
// the curve is a relative shape, and the client flushes each bucket once
// per continuous pass.

// Who is flushing. The anonymous identity is the trial_sessions token — the
// web's trial_session cookie value, or the app's device id, which takes the
// same slot (see /api/v1/playback-token). `maxPosition` is how deep an
// anonymous viewer may legitimately be on this show: null = any ready
// episode (open free mode), N = the first N in the show's ready ordering
// (the app's positional signup gate) — the surface decides, the write
// enforces.
export type SegmentsCaller =
  | { kind: "user"; userId: string }
  | { kind: "anonymous"; sessionToken: string; maxPosition: number | null };

// Why a flush did or did not count. The web action drops this (silent-
// return contract); the app route maps it to a status code.
export type SaveWatchSegmentsResult =
  | { outcome: "saved"; accepted: number }
  | { outcome: "invalid_input" }
  | { outcome: "not_found" }
  | { outcome: "forbidden" }
  | { outcome: "no_session" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveWatchSegmentsFor(
  caller: SegmentsCaller,
  episodeId: string,
  buckets: number[],
): Promise<SaveWatchSegmentsResult> {
  // Shape-guard before the uuid column ever sees the value: both surfaces
  // are client-invocable and neither may surface a masked DB throw.
  if (typeof episodeId !== "string" || !UUID_RE.test(episodeId)) {
    return { outcome: "invalid_input" };
  }
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return { outcome: "invalid_input" };
  }
  if (buckets.length > WATCH_SEGMENT_FLUSH_MAX_BUCKETS) {
    return { outcome: "invalid_input" };
  }

  const [ep] = await db
    .select({
      id: episodes.id,
      showId: seasons.showId,
      access: episodes.access,
      durationSeconds: episodes.durationSeconds,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.status, "ready"),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);
  if (!ep) return { outcome: "not_found" };

  if (caller.kind === "user") {
    // Same ownership gate as the progress save: no counters for content
    // the caller couldn't legitimately play. Payments off → every episode
    // is playable and the subscription lookup is skipped.
    if (paymentsEnabled() && !(await hasActiveSubscription(caller.userId))) {
      if (ep.access === "subscriber") return { outcome: "forbidden" };
    }
  } else {
    // Positional gate (the app under after_episodes: N). The token route
    // refuses a token past the gate, but a device that watched episode 1
    // already holds a session row for the show — the row alone would let a
    // forged flush paint counters onto episode 2. Same ordering as the
    // token route and the web funnel, so "episode 2" means one thing.
    if (caller.maxPosition !== null) {
      const ordered = await getOrderedReadyEpisodeIds(ep.showId);
      const position = ordered.indexOf(episodeId) + 1;
      if (position === 0 || position > caller.maxPosition) {
        return { outcome: "forbidden" };
      }
    }
    // Anonymous callers must hold a REAL session row for this show —
    // token presence alone would let any junk value increment the shared
    // counters. The row is minted by the token route at playback start, so
    // honest viewers always have one before their first flush.
    const [sess] = await db
      .select({ id: trialSessions.id })
      .from(trialSessions)
      .where(
        and(
          eq(trialSessions.sessionToken, caller.sessionToken),
          eq(trialSessions.showId, ep.showId),
        ),
      )
      .limit(1);
    if (!sess) return { outcome: "no_session" };
  }

  // Bound buckets to the episode's actual timeline (unknown duration → the
  // same 24h ceiling the position clamp uses). Non-integers and negatives
  // are dropped, not rejected: a buffered playhead that ran a hair past the
  // end is honest noise, and the caller learns the count that landed.
  const maxBucket = Math.floor(
    (ep.durationSeconds ?? POSITION_SECONDS_MAX) / WATCH_SEGMENT_BUCKET_SECONDS,
  );
  const clean = [
    ...new Set(
      buckets.filter((b) => Number.isInteger(b) && b >= 0 && b <= maxBucket),
    ),
  ];
  if (clean.length === 0) return { outcome: "saved", accepted: 0 };

  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(watchSegments)
    .values(clean.map((bucket) => ({ episodeId, day, bucket, views: 1 })))
    .onConflictDoUpdate({
      target: [watchSegments.episodeId, watchSegments.day, watchSegments.bucket],
      set: { views: sql`${watchSegments.views} + 1` },
    });

  if (caller.kind === "user") {
    const watched = clean.length * WATCH_SEGMENT_BUCKET_SECONDS;
    // UPDATE-only, deliberately not an upsert: a flush can precede the
    // first 10s progress save, but inserting a placeholder row here
    // (position 0) would surface a ghost 0%-progress tile in the
    // continue-watching rail. Losing ≤20s of the cumulative counter on
    // the very first flush is the cheaper error.
    await db
      .update(watchProgress)
      .set({
        totalWatchedSeconds: sql`${watchProgress.totalWatchedSeconds} + ${watched}`,
      })
      .where(
        and(
          eq(watchProgress.userId, caller.userId),
          eq(watchProgress.episodeId, episodeId),
        ),
      );
  }

  return { outcome: "saved", accepted: clean.length };
}
