import { and, asc, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import type { EpisodeSummary, ShowDetail } from "@/lib/api/types";
import { absoluteMediaUrl, apiError, apiOk } from "@/lib/api/v1";
import { muxThumbnailUrl } from "@/lib/mux-token";

// GET /api/v1/shows/:slug — one published show plus its ready episodes.
//
// Auth-independent for the same reason as /v1/catalog: `access` is returned
// RAW and gating lives in /v1/playback-token. Playback ids are never exposed;
// the only Mux identifier that leaves here is inside a signed thumbnail URL
// whose JWT has audience 't' and cannot mint video.

export const runtime = "nodejs";

// Longer than the web's 1h page-render TTL: a mobile client renders an episode
// list from memory long after the fetch, and a phone that slept for two hours
// should not wake up to broken thumbnails. The response's own cache lifetime
// is capped well below this.
const THUMBNAIL_TTL_SECONDS = 60 * 60 * 6;

// Thumbnails embedded in the body expire, so the cached copy must not outlive
// them by any meaningful margin. 60s matches /v1/catalog.
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const [show] = await db
    .select()
    .from(shows)
    .where(
      and(
        eq(shows.slug, slug),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);

  if (!show) {
    return apiError("not_found", "Show not found");
  }

  // Ready episodes only, in the same (season, episode) order as
  // getOrderedReadyEpisodeIds — the app's episode depth must match the web's
  // funnel positions or the two surfaces disagree about "episode 2".
  const rows = await db
    .select({
      id: episodes.id,
      seasonNumber: seasons.number,
      number: episodes.number,
      title: episodes.title,
      description: episodes.description,
      durationSeconds: episodes.durationSeconds,
      access: episodes.access,
      releasedAt: episodes.releasedAt,
      introStartSeconds: episodes.introStartSeconds,
      introEndSeconds: episodes.introEndSeconds,
      muxPlaybackId: episodes.muxPlaybackId,
      muxPlaybackPolicy: episodes.muxPlaybackPolicy,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(and(eq(seasons.showId, show.id), eq(episodes.status, "ready")))
    .orderBy(asc(seasons.number), asc(episodes.number));

  const episodeList = rows.map((r): EpisodeSummary => {
    // muxPlaybackId is consumed here and deliberately dropped from the DTO.
    const thumbnailUrl = r.muxPlaybackId
      ? muxThumbnailUrl(r.muxPlaybackId, r.muxPlaybackPolicy, {
          width: 640,
          ttlSeconds: THUMBNAIL_TTL_SECONDS,
        })
      : null;
    return {
      id: r.id,
      seasonNumber: r.seasonNumber,
      number: r.number,
      title: r.title,
      description: r.description,
      durationSeconds: r.durationSeconds,
      access: r.access,
      releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null,
      thumbnailUrl,
      introStartSeconds: r.introStartSeconds,
      introEndSeconds: r.introEndSeconds,
    };
  });

  const body: ShowDetail = {
    id: show.id,
    slug: show.slug,
    title: show.title,
    synopsis: show.description,
    genre: show.genre,
    orientation: show.orientation,
    posterImageUrl: absoluteMediaUrl(show.posterImageUrl),
    heroImageUrl: absoluteMediaUrl(show.heroImageUrl),
    episodeCount: episodeList.length,
    featured: show.featured,
    justReleased: show.justReleased,
    popularNow: show.popularNow,
    episodes: episodeList,
  };

  return apiOk(body, { headers: { "Cache-Control": CACHE_CONTROL } });
}
