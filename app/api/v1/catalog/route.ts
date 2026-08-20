import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import type { CatalogResponse, ShowSummary } from "@/lib/api/types";
import { absoluteMediaUrl, apiOk } from "@/lib/api/v1";

// GET /api/v1/catalog — every published show, with its ready-episode count.
//
// Deliberately auth-independent: the response is identical for every caller,
// which is what lets it be CDN-cached and shared between anonymous and
// signed-in clients. Access gating is NOT expressed here — the client derives
// presentation from /v1/config.signupGate and /v1/playback-token remains the
// enforcement point.
//
// This intentionally does NOT reuse lib/catalog.ts:getPublishedShows(). That
// helper is cached under the 'catalog' tag, which admin show mutations bust —
// but the ready-episode count also changes on the Mux webhook, which does not.
// A tag-cached count would go stale the moment an upload finished. One
// grouped query, short CDN cache, no staleness class that nothing invalidates.

export const runtime = "nodejs";

// 60s at the edge: the catalog changes on admin publish, which is rare, and a
// minute of staleness on a show list is invisible. Public (not private) —
// there is nothing caller-specific in this response.
const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET() {
  const rows = await db
    .select({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      description: shows.description,
      genre: shows.genre,
      orientation: shows.orientation,
      posterImageUrl: shows.posterImageUrl,
      heroImageUrl: shows.heroImageUrl,
      featured: shows.featured,
      justReleased: shows.justReleased,
      popularNow: shows.popularNow,
      // Filtered aggregate — Drizzle has no typed helper for FILTER (WHERE …),
      // so the count uses a sql`` fragment. Still a Drizzle query, not the raw
      // SQL the conventions forbid.
      episodeCount: sql<number>`count(${episodes.id}) filter (where ${episodes.status} = 'ready')`,
    })
    .from(shows)
    .leftJoin(seasons, eq(seasons.showId, shows.id))
    .leftJoin(episodes, eq(episodes.seasonId, seasons.id))
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)))
    // Grouping by the primary key lets Postgres functionally determine every
    // other selected shows column, so they don't each need listing.
    .groupBy(shows.id)
    .orderBy(desc(shows.createdAt));

  const body: CatalogResponse = {
    shows: rows.map(
      (r): ShowSummary => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        synopsis: r.description,
        genre: r.genre,
        orientation: r.orientation,
        posterImageUrl: absoluteMediaUrl(r.posterImageUrl),
        heroImageUrl: absoluteMediaUrl(r.heroImageUrl),
        episodeCount: Number(r.episodeCount),
        featured: r.featured,
        justReleased: r.justReleased,
        popularNow: r.popularNow,
      }),
    ),
  };

  return apiOk(body, { headers: { "Cache-Control": CACHE_CONTROL } });
}
