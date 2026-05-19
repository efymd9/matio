import type { MetadataRoute } from "next";

// SEO directive surface. The catalog (/, /shows/<slug>) is fair game for
// indexing. Everything user-specific or token-gated stays disallowed:
//   /admin/*    — admin panel
//   /api/*      — JWT issuer, webhooks, billing portal redirect
//   /subscribe  — checkout form
//   /watch/*    — burns trials when crawled; we don't want Googlebot
//                  consuming previews on behalf of real users.
//
// Sitemap pointer matches app/sitemap.ts.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://matio-ten.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/subscribe", "/watch"],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
    host: APP_URL,
  };
}
