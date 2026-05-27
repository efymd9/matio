import type { MetadataRoute } from "next";
import { getPublishedShows } from "@/lib/catalog";

// XML sitemap for indexers. Includes only published, not-soft-deleted
// shows — same filter the catalog applies. /watch and /admin and other
// gated routes are excluded here AND blocked in robots.ts.
//
// force-dynamic so a freshly-soft-deleted show drops out of the sitemap
// on the next crawler hit, rather than being frozen at build time. The
// underlying query is cached via lib/catalog.ts (revalidated by admin
// mutations) so this dynamic path still hits the cache on warm calls.
export const dynamic = "force-dynamic";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://matio.tv";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const published = await getPublishedShows();

  const now = new Date();
  return [
    {
      url: APP_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...published.map((s) => ({
      url: `${APP_URL}/shows/${s.slug}`,
      lastModified: s.updatedAt ?? now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    // Legal pages are public and worth indexing for trust signals + GDPR
    // discoverability. Low priority so they don't compete with content.
    {
      url: `${APP_URL}/terms`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    },
    {
      url: `${APP_URL}/privacy`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    },
    {
      url: `${APP_URL}/cookies`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.2,
    },
  ];
}
