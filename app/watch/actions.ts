"use server";

import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { watchProgress } from "@/db/schema";

export async function saveWatchProgress(
  episodeId: string,
  positionSeconds: number,
  completed: boolean,
) {
  const { userId } = await auth();
  if (!userId) return; // anonymous viewers: no-op for Phase 4

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
