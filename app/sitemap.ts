import type { MetadataRoute } from "next";
import { getPublishedShows } from "@/lib/catalog";
import { SITE_URL } from "@/lib/seo";

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

  // Real, verifiable home lastmod = the newest catalog change (shows.updatedAt
  // bumps on edit). Google ignores <changefreq>/<priority> and only trusts an
  // accurate <lastmod>, so we must NOT churn it with new Date() on every crawl.
  const catalogLastMod = published.reduce(
    (max, s) => (s.updatedAt && s.updatedAt > max ? s.updatedAt : max),
    LAUNCH_DATE,
  );

  return [
    {
      url: SITE_URL,
      lastModified: catalogLastMod,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/about`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    ...published.map((s) => ({
      url: `${SITE_URL}/shows/${s.slug}`,
      lastModified: s.updatedAt ?? catalogLastMod,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    // Legal pages: lastModified intentionally OMITTED. They're DRAFT pending
    // counsel review, so any hard-coded date would soon be wrong/stale — and
    // Google permits omitting lastmod, which is strictly better than a wrong
    // one. Low priority so they don't compete with content.
    {
      url: `${SITE_URL}/terms`,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/privacy`,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/cookies`,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    },
  ];
}
