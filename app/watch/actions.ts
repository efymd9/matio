"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  episodes,
  seasons,
  subscriptions,
  trialSessions,
  watchProgress,
} from "@/db/schema";
import { TRIAL_COOKIE } from "@/lib/trial";

export async function saveWatchProgress(
  episodeId: string,
  positionSeconds: number,
  completed: boolean,
) {
  const { userId } = await auth();
  if (!userId) return;

  // Ownership gate: only active subscribers may write watch_progress.
  // Without this, any signed-in user could call the action with any
  // episode UUID and poison their own row — or use error/no-error
  // differentiation to enumerate episode UUIDs (since watchProgress has
  // an FK to episodes.id). Same shape as the watch page subscriber check.
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "active"),
        gt(subscriptions.currentPeriodEnd, new Date()),
      ),
    )
    .limit(1);
  if (!sub) return;

  await db
    .insert(watchProgress)
    .values({ userId, episodeId, positionSeconds, completed })
    .onConflictDoUpdate({
      target: [watchProgress.userId, watchProgress.episodeId],
      set: {
        positionSeconds,
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

  const [row] = await db
    .select({ showId: seasons.showId })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!row) return;

  await db
    .update(trialSessions)
    .set({ lastPositionSeconds: positionSeconds })
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        eq(trialSessions.showId, row.showId),
      ),
    );
}
