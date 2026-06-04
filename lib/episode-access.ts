import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";

// Per-episode access control. An episode's tier IS its `access` column
// (free | member | subscriber — admin-set, default subscriber). A show is
// tier-gated iff any ready episode sits below the subscriber tier
// (showHasTierGating); all-subscriber shows keep the legacy 60-second
// preview. Positions in the ready ordering (getOrderedReadyEpisodeIds)
// remain the funnel's depth metric.

export type EpisodeTier = "free" | "member" | "subscriber";

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

// A show is tier-gated iff at least one READY episode is open below the
// subscriber tier. Gated shows use per-episode walls; shows where every
// ready episode is subscriber-only keep the legacy 60-second preview.
// One indexed probe — limit 1, not a count.
export async function showHasTierGating(showId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.showId, showId),
        eq(episodes.status, "ready"),
        ne(episodes.access, "subscriber"),
      ),
    )
    .limit(1);
  return row !== undefined;
}
