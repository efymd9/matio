import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { episodes, seasons, shows, trialSessions, watchProgress } from "@/db/schema";
import { TRIAL_COOKIE } from "@/lib/trial";

// One "keep watching" tile. `fraction` is the resume playhead as a share of
// the episode's duration, clamped to [0, 1]. `updatedAt` drives ordering
// (most-recently-watched first). Resume position itself is resolved
// server-side on /watch — the tile deep-links to the episode (?ep=) so the
// click lands on the same episode the tile promises.
export type ContinueWatchingItem = {
  show: {
    slug: string;
    title: string;
    heroImageUrl: string | null;
    posterImageUrl: string | null;
  };
  episodeId: string;
  episodeNumber: number;
  fraction: number;
  updatedAt: Date;
};

// How many candidate rows to pull before de-duping to one tile per show. A
// user can have many watch_progress rows per show (one per episode); we keep
// only the latest-touched show, so over-fetch then collapse in JS.
const CANDIDATE_LIMIT = 48;
const MAX_ITEMS = 12;

function clampFraction(position: number, duration: number | null): number | null {
  if (!duration || duration <= 0) return null;
  return Math.min(1, Math.max(0, position / duration));
}

// Past this share of the runtime the episode counts as finished — the show
// leaves the rail instead of sitting at a full progress bar forever.
const FINISHED_FRACTION = 0.95;

// Collapse rows (already sorted most-recent-first) to one tile per show,
// capped at MAX_ITEMS. The LATEST row per show decides its fate: if that
// row is finished (completed flag or ≥95% watched) or its duration is
// still unknown, the show gets no tile — falling through to an older row
// would resurface a stale episode/position.
function collapse(
  rows: Array<{
    slug: string;
    title: string;
    heroImageUrl: string | null;
    posterImageUrl: string | null;
    episodeId: string;
    episodeNumber: number;
    positionSeconds: number;
    durationSeconds: number | null;
    completed: boolean;
    updatedAt: Date;
  }>,
): ContinueWatchingItem[] {
  const seen = new Set<string>();
  const items: ContinueWatchingItem[] = [];
  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    const fraction = clampFraction(row.positionSeconds, row.durationSeconds);
    if (fraction === null) continue;
    if (row.completed || fraction >= FINISHED_FRACTION) continue;
    items.push({
      show: {
        slug: row.slug,
        title: row.title,
        heroImageUrl: row.heroImageUrl,
        posterImageUrl: row.posterImageUrl,
      },
      episodeId: row.episodeId,
      episodeNumber: row.episodeNumber,
      fraction,
      updatedAt: row.updatedAt,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

// Resume rail for the home page. Signed-in users get their watch_progress;
// anonymous visitors get the episode-gated trial_sessions that carry a
// last-watched episode. Returns [] (row hidden) when there's nothing to
// resume. Must run in a request scope (page.tsx is force-dynamic).
export async function getContinueWatching(): Promise<ContinueWatchingItem[]> {
  const { userId } = await auth();

  if (userId) {
    const rows = await db
      .select({
        slug: shows.slug,
        title: shows.title,
        heroImageUrl: shows.heroImageUrl,
        posterImageUrl: shows.posterImageUrl,
        episodeId: episodes.id,
        episodeNumber: episodes.number,
        positionSeconds: watchProgress.positionSeconds,
        durationSeconds: episodes.durationSeconds,
        completed: watchProgress.completed,
        updatedAt: watchProgress.updatedAt,
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(episodes.id, watchProgress.episodeId))
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .innerJoin(shows, eq(shows.id, seasons.showId))
      .where(
        and(
          eq(watchProgress.userId, userId),
          eq(shows.status, "published"),
          isNull(shows.deletedAt),
          eq(episodes.status, "ready"),
        ),
      )
      .orderBy(desc(watchProgress.updatedAt))
      .limit(CANDIDATE_LIMIT);
    return collapse(rows);
  }

  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return [];

  const rows = await db
    .select({
      slug: shows.slug,
      title: shows.title,
      heroImageUrl: shows.heroImageUrl,
      posterImageUrl: shows.posterImageUrl,
      episodeId: episodes.id,
      episodeNumber: episodes.number,
      positionSeconds: trialSessions.lastPositionSeconds,
      durationSeconds: episodes.durationSeconds,
      // trial_sessions carries no completed flag; the ≥95% fraction
      // threshold in collapse() stands in for it.
      completed: sql<boolean>`false`,
      // trial_sessions has no updated_at; started_at is the closest proxy
      // for "most recent session" ordering.
      updatedAt: trialSessions.startedAt,
    })
    .from(trialSessions)
    .innerJoin(episodes, eq(episodes.id, trialSessions.lastEpisodeId))
    .innerJoin(shows, eq(shows.id, trialSessions.showId))
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        isNotNull(trialSessions.lastEpisodeId),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
        eq(episodes.status, "ready"),
      ),
    )
    .orderBy(desc(trialSessions.startedAt))
    .limit(CANDIDATE_LIMIT);
  return collapse(rows);
}
