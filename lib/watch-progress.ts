import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows, watchDays, watchProgress } from "@/db/schema";
import { paymentsEnabled } from "@/lib/free-mode";
import { hasActiveSubscription } from "@/lib/subscription-access";

// The watch-progress write, shared by the web's server action
// (app/watch/actions.ts:saveWatchProgress) and the app's POST /api/v1/progress.
// One implementation on purpose: the invariants below — the position clamp,
// the monotonic max_position_seconds, completed's flip-on-rewatch semantics,
// the same-tick watch_days ledger, the paid-mode ownership gate — are what
// the continue-watching rail and the retention dashboard read, and two copies
// of them would drift exactly where nobody is looking.
//
// Idempotent by construction: the natural key (user_id, episode_id) plus
// ON CONFLICT DO UPDATE means a retried save (double flush, lost response,
// app relaunch) updates the same row and never creates a second one.

// Hard ceiling on position values that can be written. The longest
// imaginable single episode is ~3-4h; 24h is a generous bound that
// rejects pathological values (negative, NaN, 10^9, …) without
// constraining real playback.
export const POSITION_SECONDS_MAX = 24 * 60 * 60;

// Returns null when the value is anything other than a finite non-negative
// number within range; otherwise the value floored to whole seconds.
export function clampPositionSeconds(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > POSITION_SECONDS_MAX) return null;
  return Math.floor(n);
}

// Why a save did not happen. The web action ignores this (its contract is
// silent-return); the app route maps it to a status code so a client can
// tell a rejected position from a vanished episode.
export type SaveWatchProgressOutcome =
  | "saved"
  | "invalid_position"
  | "not_found"
  | "forbidden";

export async function saveWatchProgressForUser(
  userId: string,
  episodeId: string,
  positionSeconds: number,
  completed: boolean,
): Promise<SaveWatchProgressOutcome> {
  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return "invalid_position";

  // Verify the episode is actually playable: status='ready', on a
  // published, non-deleted show — and fetch the show's gating config and
  // the episode's length in the same query for the checks below.
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
  if (!ep) return "not_found";

  // Ownership gate: subscribers may write progress on anything; signed-in
  // non-subscribers only on episodes open to them (free or member tier).
  // All-subscriber (legacy 60s-trial) shows have no such episodes, so
  // non-subscribers are rejected there exactly as before. Mirrors the token
  // route's gate so progress rows can't be written for content the user
  // can't play — with payments off every episode is playable, so the gate
  // (and its subscription lookup) is skipped.
  if (paymentsEnabled() && !(await hasActiveSubscription(userId))) {
    if (ep.access === "subscriber") return "forbidden";
  }

  // Bound the position to the episode's own timeline. The 24h clamp above
  // only rejects the absurd; this is what stops a client from posting
  // 86 400 s against a ten-minute episode and "finishing" it — the
  // dashboard reads finished as max_position ≥ 95 %·duration, and the
  // continue-watching rail would drop it. Unknown duration → the ceiling
  // alone (a buffered playhead can legitimately run a hair past the end).
  const capped = ep.durationSeconds
    ? Math.min(clamped, ep.durationSeconds)
    : clamped;

  await db
    .insert(watchProgress)
    .values({
      userId,
      episodeId,
      positionSeconds: capped,
      maxPositionSeconds: capped,
      completed,
    })
    .onConflictDoUpdate({
      target: [watchProgress.userId, watchProgress.episodeId],
      // Exactly these four. first_watched_at (release retention on the
      // dashboard) and total_watched_seconds (owned by saveWatchSegments)
      // must survive a conflict untouched — the test pins the key set.
      set: {
        positionSeconds: capped,
        // Monotonic furthest playhead — position_seconds is the resume
        // target and regresses on seek-back; depth metrics read this.
        // (completed keeps its live flip-on-rewatch semantics — the
        // continue-watching rail depends on it; "ever finished" analytics
        // read max_position_seconds ≥ duration instead.)
        maxPositionSeconds: sql`GREATEST(${watchProgress.maxPositionSeconds}, ${capped})`,
        completed,
        updatedAt: new Date(),
      },
    });

  // Per-day activity ledger for the dashboard's living-audience metrics
  // (rolling WAU, new/returning/lost). One no-op upsert per save tick.
  await db
    .insert(watchDays)
    .values({ userId, day: new Date().toISOString().slice(0, 10) })
    .onConflictDoNothing();

  return "saved";
}
