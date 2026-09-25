import { auth } from "@clerk/nextjs/server";
import { and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";
import type { ContinueResponse, ContinueWatchingEntry } from "@/lib/api/types";
import { absoluteMediaUrl, apiError, apiOk, linearShowsOnly } from "@/lib/api/v1";
import { getContinueWatching } from "@/lib/continue-watching";

// GET /api/v1/continue — the app's "continue watching" rail.
//
// Reuses the web home page's getContinueWatching() verbatim: published shows
// only, ready episodes only, one tile per show (the latest-touched row
// decides), finished episodes dropped. The route adds the HTTP shape — Bearer
// auth, absolute media URLs (a native client has no origin to resolve a
// legacy "/shows/…png" against), ISO timestamps — and one filter: the app's
// view of the catalog (below).
//
// Signed-in only: the helper's anonymous branch reads the web's trial
// cookie, which a native client never holds, so for the app an anonymous
// call can only ever be empty — answered as 401 so a signed-out client
// doesn't mistake "no cookie" for "nothing to resume".

export const runtime = "nodejs";

// The shows among `slugs` the app may show at all: the same linearShowsOnly()
// WHERE as /v1/catalog and /v1/shows/:slug (#143). A branching show is absent
// from the app wholesale — its /v1/shows/:slug answers 404 — so a resume tile
// for one (watched before it became branching, or on the web) would be the
// Home screen's first «Up next» card leading to a dead end (#288).
async function appVisibleSlugs(slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db
    .select({ slug: shows.slug })
    .from(shows)
    .where(and(inArray(shows.slug, slugs), linearShowsOnly()));
  return new Set(rows.map((row) => row.slug));
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return apiError("unauthorized", "Sign in to see what you were watching.");
  }

  const items = await getContinueWatching();
  const visible = await appVisibleSlugs(items.map((item) => item.show.slug));

  const body: ContinueResponse = {
    items: items
      .filter((item) => visible.has(item.show.slug))
      .map(
        (item): ContinueWatchingEntry => ({
          show: {
            slug: item.show.slug,
            title: item.show.title,
            orientation: item.show.orientation,
            posterImageUrl: absoluteMediaUrl(item.show.posterImageUrl),
            heroImageUrl: absoluteMediaUrl(item.show.heroImageUrl),
          },
          episodeId: item.episodeId,
          episodeNumber: item.episodeNumber,
          episodeTitle: item.episodeTitle,
          positionSeconds: item.positionSeconds,
          durationSeconds: item.durationSeconds,
          fraction: item.fraction,
          updatedAt: item.updatedAt.toISOString(),
        }),
      ),
  };

  // Per-user answer: apiOk's default private/no-store is exactly right.
  return apiOk(body);
}
