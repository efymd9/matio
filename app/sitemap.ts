import type { MetadataRoute } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";

// XML sitemap for indexers. Includes only published, not-soft-deleted
// shows — same filter the catalog applies. /watch and /admin and other
// gated routes are excluded here AND blocked in robots.ts.
//
// Re-fetched on every request because /shows entries change daily as the
// admin publishes new content; with ~tens of shows the cost is trivial.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://matio-ten.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const published = await db
    .select({ slug: shows.slug, updatedAt: shows.updatedAt })
    .from(shows)
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)));

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
  ];
}
