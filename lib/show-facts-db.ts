import "server-only";
import { and, count, eq, inArray, isNull, max, min } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import type { EpisodeStats } from "./show-facts";

// Episode count + shortest / longest run time per show, over the LISTED run:
// ready episodes, branches excluded (#143) — the same count the show page
// advertises. One grouped query for every show asked about; a show with no
// ready episode is simply absent from the map.
export async function loadEpisodeStats(
  showIds: readonly string[],
): Promise<Map<string, EpisodeStats>> {
  if (showIds.length === 0) return new Map();
  const rows = await db
    .select({
      showId: seasons.showId,
      count: count(episodes.id),
      minSeconds: min(episodes.durationSeconds),
      maxSeconds: max(episodes.durationSeconds),
    })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .where(
      and(
        inArray(seasons.showId, [...showIds]),
        eq(episodes.status, "ready"),
        isNull(episodes.branchOfEpisodeId),
      ),
    )
    .groupBy(seasons.showId);
  return new Map(
    rows.map((r) => [
      r.showId,
      { count: Number(r.count), minSeconds: r.minSeconds, maxSeconds: r.maxSeconds },
    ]),
  );
}
