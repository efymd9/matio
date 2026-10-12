import type { MetadataRoute } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { actors, showActors, shows } from "@/db/schema";
import { getPublishedShows } from "@/lib/catalog";
import { canonicalUrl } from "@/lib/seo";

// One <url> per route, at its bare English canonical. The site is
// English-only since #445: the /es URLs it listed (with an en/es/x-default
// hreflang cluster on every entry) now 308 to these, and a sitemap must list
// only URLs that answer 200.
function entry(
  basePath: string,
  opts: Omit<MetadataRoute.Sitemap[number], "url">,
): MetadataRoute.Sitemap[number] {
  return { url: canonicalUrl(basePath), ...opts };
}

// XML sitemap for indexers. Includes only published, not-soft-deleted shows —
// same filter the catalog applies. /watch, /subscribe, /admin and other gated
// routes are excluded here AND blocked in robots.ts.
//
// force-dynamic so a freshly-soft-deleted show drops out of the sitemap on the
// next crawler hit, rather than being frozen at build time. The underlying
// query is cached via lib/catalog.ts (revalidated by admin mutations) so this
// dynamic path still hits the cache on warm calls.
export const dynamic = "force-dynamic";

// Site launch — floor for the home lastmod when the catalog is empty. Never
// emit a 1970/epoch date (it trains Google to distrust the lastmod signal).
const LAUNCH_DATE = new Date("2026-05-27T00:00:00Z");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const published = await getPublishedShows();

  // Virtual-actor profiles — only actors credited on ≥1 published show, so
  // an unattached (or drafts-only) actor never surfaces as a thin indexed
  // page. Distinct because an actor can appear in several published shows.
  const publishedActors = await db
    .selectDistinct({ slug: actors.slug, updatedAt: actors.updatedAt })
    .from(actors)
    .innerJoin(showActors, eq(showActors.actorId, actors.id))
    .innerJoin(shows, eq(showActors.showId, shows.id))
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)));

  // Real, verifiable home lastmod = the newest catalog change (shows.updatedAt
  // bumps on edit). Google ignores <changefreq>/<priority> and only trusts an
  // accurate <lastmod>, so we must NOT churn it with new Date() on every crawl.
  const catalogLastMod = published.reduce(
    (max, s) => (s.updatedAt && s.updatedAt > max ? s.updatedAt : max),
    LAUNCH_DATE,
  );

  return [
    entry("/", {
      lastModified: catalogLastMod,
      changeFrequency: "daily",
      priority: 1,
    }),
    entry("/about", {
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    entry("/press", {
      changeFrequency: "monthly",
      priority: 0.3,
    }),
    // The story-idea landing (#297) — indexed on purpose: it is where the
    // fan campaigns land.
    entry("/ideas", {
      changeFrequency: "monthly",
      priority: 0.5,
    }),
    ...published.map((s) =>
      entry(`/shows/${s.slug}`, {
        lastModified: s.updatedAt ?? catalogLastMod,
        changeFrequency: "weekly",
        priority: 0.8,
      }),
    ),
    ...publishedActors.map((a) =>
      entry(`/actors/${a.slug}`, {
        lastModified: a.updatedAt,
        changeFrequency: "monthly",
        priority: 0.4,
      }),
    ),
    // Legal pages: lastModified intentionally OMITTED. They're DRAFT pending
    // counsel review, so any hard-coded date would soon be wrong/stale — and
    // Google permits omitting lastmod, which is strictly better than a wrong
    // one. Low priority so they don't compete with content.
    entry("/terms", {
      changeFrequency: "monthly",
      priority: 0.2,
    }),
    entry("/privacy", {
      changeFrequency: "monthly",
      priority: 0.2,
    }),
    entry("/cookies", {
      changeFrequency: "monthly",
      priority: 0.2,
    }),
  ];
}
