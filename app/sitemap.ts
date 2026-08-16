import type { MetadataRoute } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { actors, showActors, shows } from "@/db/schema";
import { getPublishedShows } from "@/lib/catalog";
import { canonicalUrl, localizedPath } from "@/lib/seo";

// Emit BOTH language versions of a route as their own <url> entries, each
// carrying the full reciprocal en/es/x-default cluster (English is canonical +
// x-default; Spanish lives at /es). Google's documented preference is that
// every URL in a language set appears as its own <loc> listing all versions
// including itself — listing only the English entry would leave the /es URLs
// discoverable ONLY via the annotation, which matters here because the
// language switcher is the sole in-page link to them.
function localizedEntries(
  basePath: string,
  opts: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">,
): MetadataRoute.Sitemap {
  const languages = {
    en: canonicalUrl(basePath),
    es: canonicalUrl(localizedPath(basePath, "es")),
    "x-default": canonicalUrl(basePath),
  };
  return [
    { url: languages.en, ...opts, alternates: { languages } },
    { url: languages.es, ...opts, alternates: { languages } },
  ];
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
    ...localizedEntries("/", {
      lastModified: catalogLastMod,
      changeFrequency: "daily",
      priority: 1,
    }),
    ...localizedEntries("/about", {
      changeFrequency: "yearly",
      priority: 0.3,
    }),
    ...localizedEntries("/press", {
      changeFrequency: "monthly",
      priority: 0.3,
    }),
    ...published.flatMap((s) =>
      localizedEntries(`/shows/${s.slug}`, {
        lastModified: s.updatedAt ?? catalogLastMod,
        changeFrequency: "weekly",
        priority: 0.8,
      }),
    ),
    ...publishedActors.flatMap((a) =>
      localizedEntries(`/actors/${a.slug}`, {
        lastModified: a.updatedAt,
        changeFrequency: "monthly",
        priority: 0.4,
      }),
    ),
    // Legal pages: lastModified intentionally OMITTED. They're DRAFT pending
    // counsel review, so any hard-coded date would soon be wrong/stale — and
    // Google permits omitting lastmod, which is strictly better than a wrong
    // one. Low priority so they don't compete with content.
    ...localizedEntries("/terms", {
      changeFrequency: "monthly",
      priority: 0.2,
    }),
    ...localizedEntries("/privacy", {
      changeFrequency: "monthly",
      priority: 0.2,
    }),
    ...localizedEntries("/cookies", {
      changeFrequency: "monthly",
      priority: 0.2,
    }),
  ];
}
