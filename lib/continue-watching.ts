import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  episodeChoices,
  episodes,
  seasons,
  shows,
  trialSessions,
  watchProgress,
  type ShowOrientation,
} from "@/db/schema";
import { TRIAL_COOKIE } from "@/lib/trial";

// One "keep watching" tile. `fraction` is the resume playhead as a share of
// the episode's duration, clamped to [0, 1]. `updatedAt` drives ordering
// (most-recently-watched first). On the web the resume position is resolved
// server-side on /watch — the tile deep-links to the episode (?ep=) so the
// click lands on the same episode the tile promises. The app has no such
// server render, so the tile also carries the raw `positionSeconds` /
// `durationSeconds` (and the show's orientation, which picks its player
// chrome) — additive fields the web rail simply ignores.
export type ContinueWatchingItem = {
  show: {
    slug: string;
    title: string;
    orientation: ShowOrientation;
    heroImageUrl: string | null;
    posterImageUrl: string | null;
  };
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  positionSeconds: number;
  durationSeconds: number;
  fraction: number;
  updatedAt: Date;
};

// How many candidate rows to pull before de-duping to one tile per show. A
// user can have many watch_progress rows per show (one per episode); we keep
// only the latest-touched show, so over-fetch then collapse in JS.
const CANDIDATE_LIMIT = 48;
const MAX_ITEMS = 12;

// Past this share of the runtime the episode counts as finished — the show
// leaves the rail instead of sitting at a full progress bar forever.
const FINISHED_FRACTION = 0.95;

type CandidateRow = {
  slug: string;
  title: string;
  orientation: ShowOrientation;
  heroImageUrl: string | null;
  posterImageUrl: string | null;
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  positionSeconds: number;
  durationSeconds: number | null;
  completed: boolean;
  updatedAt: Date;
  // Branching video (#143): set when the row's episode is a branch.
  branchOfEpisodeId: string | null;
};

// Where a finished BRANCH leads next: the target of its single silent
// choice (the reconvergence hop), keyed by the branch's episode id. Only
// single-choice branches map — a fork at the end of a branch needs the
// viewer's pick, and an ending has nowhere to go.
type Continuation = {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  durationSeconds: number | null;
};

// Collapse rows (already sorted most-recent-first) to one tile per show,
// capped at MAX_ITEMS. The LATEST row per show decides its fate: if that
// row is finished (completed flag or ≥95% watched) or its duration is
// still unknown, the show gets no tile — falling through to an older row
// would resurface a stale episode/position.
//
// Branches (#143) are handled in two halves. A FINISHED branch whose single
// choice leads on becomes a tile for THAT episode at 0:00 — a linear episode
// leaves the rail when finished because auto-advance writes the next row
// within seconds; a branch's silent hop is the same moment, but a viewer who
// stops exactly at the seam would otherwise lose the show from the rail. An
// UNFINISHED branch yields no tile at all until the player can play one
// (#144): today its ?ep= deep link falls back to episode 1, and a tile that
// promises "resume 901" and lands elsewhere is worse than no tile.
function collapse(
  rows: CandidateRow[],
  continuations: Map<string, Continuation>,
): ContinueWatchingItem[] {
  const seen = new Set<string>();
  const items: ContinueWatchingItem[] = [];
  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    seen.add(row.slug);
    // Unknown duration → no fraction → no tile (and no fall-through to an
    // older row for this show — see above).
    const duration = row.durationSeconds;
    if (!duration || duration <= 0) continue;
    const fraction = Math.min(1, Math.max(0, row.positionSeconds / duration));
    const finished = row.completed || fraction >= FINISHED_FRACTION;
    const next = finished && row.branchOfEpisodeId
      ? continuations.get(row.episodeId)
      : undefined;
    if (finished && !next) continue;
    // Until #144 a branch cannot be resumed (see above) — no tile.
    if (!finished && row.branchOfEpisodeId) continue;
    const show = {
      slug: row.slug,
      title: row.title,
      orientation: row.orientation,
      heroImageUrl: row.heroImageUrl,
      posterImageUrl: row.posterImageUrl,
    };
    if (next) {
      const nextDuration = next.durationSeconds;
      if (!nextDuration || nextDuration <= 0) continue;
      items.push({
        show,
        episodeId: next.episodeId,
        episodeNumber: next.episodeNumber,
        episodeTitle: next.episodeTitle,
        positionSeconds: 0,
        durationSeconds: nextDuration,
        fraction: 0,
        updatedAt: row.updatedAt,
      });
    } else {
      items.push({
        show,
        episodeId: row.episodeId,
        episodeNumber: row.episodeNumber,
        episodeTitle: row.episodeTitle,
        positionSeconds: row.positionSeconds,
        durationSeconds: duration,
        fraction,
        updatedAt: row.updatedAt,
      });
    }
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

// Resolves the silent continuation of every branch among the candidate
// rows in one query; no branches → no query. Forks (≥2 choices) and
// endings (0) deliberately yield no entry — see collapse().
async function loadContinuations(
  rows: CandidateRow[],
): Promise<Map<string, Continuation>> {
  const map = new Map<string, Continuation>();
  const branchIds = rows
    .filter((r) => r.branchOfEpisodeId !== null)
    .map((r) => r.episodeId);
  if (branchIds.length === 0) return map;

  const edges = await db
    .select({
      fromEpisodeId: episodeChoices.fromEpisodeId,
      episodeId: episodes.id,
      episodeNumber: episodes.number,
      episodeTitle: episodes.title,
      durationSeconds: episodes.durationSeconds,
    })
    .from(episodeChoices)
    .innerJoin(episodes, eq(episodes.id, episodeChoices.toEpisodeId))
    .where(
      and(
        inArray(episodeChoices.fromEpisodeId, branchIds),
        eq(episodes.status, "ready"),
      ),
    );

  const counts = new Map<string, number>();
  for (const e of edges) {
    counts.set(e.fromEpisodeId, (counts.get(e.fromEpisodeId) ?? 0) + 1);
  }
  for (const e of edges) {
    if (counts.get(e.fromEpisodeId) !== 1) continue;
    map.set(e.fromEpisodeId, {
      episodeId: e.episodeId,
      episodeNumber: e.episodeNumber,
      episodeTitle: e.episodeTitle,
      durationSeconds: e.durationSeconds,
    });
  }
  return map;
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
        orientation: shows.orientation,
        heroImageUrl: shows.heroImageUrl,
        posterImageUrl: shows.posterImageUrl,
        episodeId: episodes.id,
        episodeNumber: episodes.number,
        episodeTitle: episodes.title,
        positionSeconds: watchProgress.positionSeconds,
        durationSeconds: episodes.durationSeconds,
        completed: watchProgress.completed,
        updatedAt: watchProgress.updatedAt,
        branchOfEpisodeId: episodes.branchOfEpisodeId,
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
    return collapse(rows, await loadContinuations(rows));
  }

  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return [];

  const rows = await db
    .select({
      slug: shows.slug,
      title: shows.title,
      orientation: shows.orientation,
      heroImageUrl: shows.heroImageUrl,
      posterImageUrl: shows.posterImageUrl,
      episodeId: episodes.id,
      episodeNumber: episodes.number,
      episodeTitle: episodes.title,
      positionSeconds: trialSessions.lastPositionSeconds,
      durationSeconds: episodes.durationSeconds,
      // trial_sessions carries no completed flag; the ≥95% fraction
      // threshold in collapse() stands in for it.
      completed: sql<boolean>`false`,
      // trial_sessions has no updated_at; started_at is the closest proxy
      // for "most recent session" ordering.
      updatedAt: trialSessions.startedAt,
      branchOfEpisodeId: episodes.branchOfEpisodeId,
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
  return collapse(rows, await loadContinuations(rows));
}
