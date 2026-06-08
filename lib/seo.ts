// Canonical SEO constants. Universal (safe in the proxy/middleware bundle and
// in client code) — keep this dependency-free.
//
// SITE_URL is HARD-PINNED to the apex and deliberately NOT derived from
// NEXT_PUBLIC_APP_URL. metadataBase (app/layout.tsx) still uses the env var so
// OG/Twitter *image* URLs resolve to the preview host when testing unfurls,
// but canonical tags + JSON-LD @ids must always point at the real apex — on a
// Vercel preview deploy NEXT_PUBLIC_APP_URL is the preview origin, and a
// relative canonical resolved against it would make every preview page
// self-canonicalize to itself (the "testing host gets indexed" hazard Google
// warns about). Absolute apex canonicals close that hole.
export const SITE_URL = "https://matio.tv";
export const SITE_NAME = "Matio";

// Legacy production alias that still resolves to this deployment. Vercel does
// NOT auto-noindex production *.vercel.app aliases (only preview deploys), so
// proxy.ts 308-redirects it to the apex to avoid a duplicate indexable origin.
export const LEGACY_ALIAS_HOST = "matio-ten.vercel.app";

// Absolute canonical URL for a route path. Pass the route path ("/",
// "/shows/foo", "/about") — never a value containing query params, or signals
// get split across ?utm_*/?ep= variants instead of consolidated.
export function canonicalUrl(path: string): string {
  if (path === "/" || path === "") return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
