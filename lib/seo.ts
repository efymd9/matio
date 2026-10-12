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

// ── The retired /es prefix ───────────────────────────────────────────────
// The site served Spanish under /es until #445 (2026-10-12); it is
// English-only now, at the bare path. The /es URLs were indexed and linked,
// so proxy.ts answers every /es and /es/* with a permanent 308 to the bare
// path (query kept) — stripLocalePrefix is the rule it reads. Expo builds
// from before #447 still open the legal pages under /es for a viewer who
// chose Español; those land on the English page through that same 308 (the
// app itself has been English-only since #447 and builds no /es URL). Kept
// dependency-free so it's safe in the middleware bundle.
export type SeoLocale = "en" | "es";
export const ES_PREFIX = "/es";

// Split an incoming request pathname into { locale, base path }.
// "/es/shows/x" → { es, "/shows/x" }; "/es" → { es, "/" }; "/shows/x" → { en,
// "/shows/x" }. Only a whole segment counts: "/espanol" is not under /es.
export function stripLocalePrefix(pathname: string): {
  locale: SeoLocale;
  path: string;
} {
  if (pathname === ES_PREFIX) return { locale: "es", path: "/" };
  if (pathname.startsWith(`${ES_PREFIX}/`)) {
    return { locale: "es", path: pathname.slice(ES_PREFIX.length) };
  }
  return { locale: "en", path: pathname };
}

// Meta-description sanitizer for DB-sourced copy. Admin-entered synopses
// carry raw \r\n paragraph breaks which would otherwise be emitted verbatim
// inside the <meta content> attribute; collapse all whitespace runs and
// truncate on a word boundary at ~160 chars (the practical SERP snippet
// budget). JSON-LD descriptions deliberately stay full-length — only the
// meta tag needs this.
export function metaDescription(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
