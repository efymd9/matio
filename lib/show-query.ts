import "server-only";

import { cache } from "react";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";

// Published-show lookup deduplicated per request via React cache(). Drizzle
// queries aren't fetch-based, so Next's fetch memoization does NOT dedupe them
// — cache() makes generateMetadata + the page body share a single DB
// round-trip instead of issuing the identical SELECT twice. (The per-show OG
// image route renders in a separate request, so it does its own read — still
// one query there.)
export const getShowBySlug = cache(async (slug: string) => {
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
  return show ?? null;
});
