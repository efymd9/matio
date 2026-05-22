"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  trialSessions,
  watchProgress,
} from "@/db/schema";
import { hasActiveSubscription } from "@/lib/subscription-access";
import { TRIAL_COOKIE } from "@/lib/trial";

// Hard ceiling on position values that can be written. The longest
// imaginable single episode is ~3-4h; 24h is a generous bound that
// rejects pathological values (negative, NaN, 10^9, …) without
// constraining real playback. Returns null when the value is anything
// other than a finite non-negative number within range.
const POSITION_SECONDS_MAX = 24 * 60 * 60;
function clampPositionSeconds(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > POSITION_SECONDS_MAX) return null;
  return Math.floor(n);
}

export async function saveWatchProgress(
  episodeId: string,
  positionSeconds: number,
  completed: boolean,
) {
  const { userId } = await auth();
  if (!userId) return;

  // Ownership gate: only access-granting subscribers may write
  // watch_progress. Without this, any signed-in user could call the
  // action with any episode UUID and poison their own row — or use
  // error/no-error differentiation to enumerate episode UUIDs (since
  // watchProgress has an FK to episodes.id). Mirrors the watch page
  // and playback-token route gates.
  if (!(await hasActiveSubscription(userId))) return;

  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return;

  // Verify the episode is actually playable: status='ready', on a
  // published, non-deleted show. The FK alone (episodeId → episodes.id)
  // would allow drafts and soft-deleted catalog entries to leak into
  // the resume queue.
  const [ep] = await db
    .select({ id: episodes.id })
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
  if (!ep) return;

  await db
    .insert(watchProgress)
    .values({
      userId,
      episodeId,
      positionSeconds: clamped,
      completed,
    })
    .onConflictDoUpdate({
      target: [watchProgress.userId, watchProgress.episodeId],
      set: {
        positionSeconds: clamped,
        completed,
        updatedAt: new Date(),
      },
    });
}

// Trial-mode position save: keyed on (session_token, show_id), looked up via
// the episode's season → show relationship. Anonymous-only — subscribers
// route to saveWatchProgress instead. Trial sessions don't track completion
// (single-show trial; no Up Next), so the caller's third arg is dropped.
export async function saveTrialPosition(
  episodeId: string,
  positionSeconds: number,
) {
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;

  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return;

  // Same episode-validity gate as the subscriber path: only ready
  // episodes on published, non-deleted shows. Stops a stray client
  // (or a forged form post on the cookie) from writing positions
  // against drafts or unpublished assets.
  const [row] = await db
    .select({ showId: seasons.showId })
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
  if (!row) return;

  // Ownership scope: only the row matching (cookie, show) gets the
  // write. An attacker with any old/expired cookie can in principle
  // dirty their own trial position, but the clamp above bounds the
  // damage, and the row is rate-limit / ip-hash gated at creation.
  await db
    .update(trialSessions)
    .set({ lastPositionSeconds: clamped })
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        eq(trialSessions.showId, row.showId),
      ),
    );
}
