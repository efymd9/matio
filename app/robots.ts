import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// SEO directive surface. The catalog (/, /shows/<slug>) is fair game for
// indexing. Everything user-specific or token-gated stays disallowed:
//   /admin/*    — admin panel
//   /api/*      — JWT issuer, webhooks, billing portal redirect
//   /subscribe  — checkout form
//   /watch/*    — burns trials when crawled; we don't want Googlebot
//                  consuming previews on behalf of real users.
//
// Sitemap + host pointers use the hard-pinned apex (not NEXT_PUBLIC_APP_URL)
// so crawlers are always pointed at the canonical apex sitemap, never a
// preview host. Matches app/sitemap.ts (also SITE_URL-based).

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/subscribe", "/watch"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
