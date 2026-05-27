import "server-only";
import { unstable_cache } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";

// Tag used by admin server actions to invalidate the catalog cache when
// a show is created, updated (status flip), or soft-deleted. See
// app/admin/actions.ts:bustCatalog.
export const CATALOG_TAG = "catalog";

// Cached published-catalog read. Home + sitemap both consume this — the
// catalog changes only when an admin publishes, unpublishes or soft-
// deletes a show, so a 1-hour fallback TTL with tag-based invalidation
// matches reality. Without this, every home hit + every sitemap fetch
// does a fresh trans-region DB query for the same data.
//
// Using `unstable_cache` rather than the Next 16 `'use cache'` directive
// because enabling `cacheComponents: true` (the prerequisite) requires
// removing `runtime = "nodejs"` from all webhook routes and
// `dynamic = "force-dynamic"` from any page that has it — too broad a
// refactor to bundle with this caching change. Migrate when the time
// to do that cleanup arrives.
export const getPublishedShows = unstable_cache(
  async () => {
    return db
      .select()
      .from(shows)
      .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)))
      .orderBy(desc(shows.createdAt));
  },
  ["catalog-published-v1"],
  {
    tags: [CATALOG_TAG],
    revalidate: 60 * 60,
  },
);
