import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";

// Episode-gated free tier (microdrama model). An episode's tier comes from
// its 1-based POSITION in the show's ready-episode ordering — ready episodes
// ordered by (season number, episode number); the same ordering the watch
// page builds for its `playable` list. Tiers are computed live at request
// time in every enforcement site (token route, watch page, progress
// actions) — never stored — so publishing/unpublishing episodes
// self-corrects everywhere on the next request.

export type EpisodeTier = "free" | "member" | "subscriber";

export type ShowGating = {
  gated: boolean;
  freeCount: number;
  memberCount: number;
};

// Negative values can't be entered through the admin form, but clamp anyway
// so a hand-edited row can't produce a nonsense tier split.
export function getShowGating(show: {
  freeEpisodes: number;
  memberEpisodes: number;
}): ShowGating {
  const freeCount = Math.max(0, show.freeEpisodes);
  const memberCount = Math.max(0, show.memberEpisodes);
  return { gated: freeCount + memberCount > 0, freeCount, memberCount };
}

export function tierForPosition(
  position: number,
  gating: ShowGating,
): EpisodeTier {
  if (!gating.gated) return "subscriber";
  if (position <= gating.freeCount) return "free";
  if (position <= gating.freeCount + gating.memberCount) return "member";
  return "subscriber";
}

// Ordered ready-episode ids for a show; position = array index + 1. The
// caller is responsible for show-level checks (published, not deleted) —
// every current caller has already verified them.
export async function getOrderedReadyEpisodeIds(
  showId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(and(eq(seasons.showId, showId), eq(episodes.status, "ready")))
    .orderBy(asc(seasons.number), asc(episodes.number));
  return rows.map((r) => r.id);
}
