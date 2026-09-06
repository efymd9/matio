import { auth } from "@clerk/nextjs/server";
import type { ContinueResponse, ContinueWatchingEntry } from "@/lib/api/types";
import { absoluteMediaUrl, apiError, apiOk } from "@/lib/api/v1";
import { getContinueWatching } from "@/lib/continue-watching";

// GET /api/v1/continue — the app's "continue watching" rail.
//
// Reuses the web home page's getContinueWatching() verbatim: published shows
// only, ready episodes only, one tile per show (the latest-touched row
// decides), finished episodes dropped. The route adds the HTTP shape — Bearer
// auth, absolute media URLs (a native client has no origin to resolve a
// legacy "/shows/…png" against), ISO timestamps — and nothing else.
//
// Signed-in only: the helper's anonymous branch reads the web's trial
// cookie, which a native client never holds, so for the app an anonymous
// call can only ever be empty — answered as 401 so a signed-out client
// doesn't mistake "no cookie" for "nothing to resume".

export const runtime = "nodejs";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return apiError("unauthorized", "Sign in to see what you were watching.");
  }

  const items = await getContinueWatching();

  const body: ContinueResponse = {
    items: items.map(
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
