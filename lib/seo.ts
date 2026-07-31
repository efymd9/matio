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

// ── Bilingual URL scheme (en/es) ─────────────────────────────────────────
// English lives at the bare path (canonical + x-default); Spanish lives under
// a /es prefix. This is the single source of truth for the split, shared by
// proxy.ts (rewrite + redirect), every generateMetadata (hreflang), the
// sitemap, and the client language switcher (navigation). Kept dependency-free
// so it's safe in the middleware and client bundles.
export type SeoLocale = "en" | "es";
export const ES_PREFIX = "/es";

// The indexable public routes that get an /es twin + reciprocal hreflang.
// Everything else (admin, api, /watch [noindex], /subscribe, /checkout, …)
// stays single-URL. A crafted /es/admin therefore does NOT match here and is
// never rewritten onto the gated route — it just 404s.
export function isLocalizablePath(path: string): boolean {
  return (
    path === "/" ||
    path === "/about" ||
    path === "/terms" ||
    path === "/privacy" ||
    path === "/cookies" ||
    path.startsWith("/shows/") ||
    path.startsWith("/actors/")
  );
}

// Split an incoming request pathname into { locale, base English path }.
// "/es/shows/x" → { es, "/shows/x" }; "/es" → { es, "/" }; "/shows/x" → { en,
// "/shows/x" }.
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

// Prefix a base (English) path with the locale segment. English is identity.
export function localizedPath(basePath: string, locale: SeoLocale): string {
  const clean =
    basePath === ""
      ? "/"
      : basePath.startsWith("/")
        ? basePath
        : `/${basePath}`;
  if (locale === "en") return clean;
  return clean === "/" ? ES_PREFIX : `${ES_PREFIX}${clean}`;
}

// hreflang alternates for a Next `alternates` metadata field. `basePath` is the
// English route; `current` is the locale actually being rendered (so the page
// self-canonicalises correctly). Emits en + es + x-default (English is the
// default). All absolute apex URLs — never preview hosts.
export function localeAlternates(
  basePath: string,
  current: SeoLocale,
): { canonical: string; languages: Record<string, string> } {
  const enUrl = canonicalUrl(basePath);
  const esUrl = canonicalUrl(localizedPath(basePath, "es"));
  return {
    canonical: current === "es" ? esUrl : enUrl,
    languages: { en: enUrl, es: esUrl, "x-default": enUrl },
  };
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

// ВРЕМЕННО: непокрытая тестами функция — проверка ворот diff-cover.
export function deliberatelyUntested(input: string): string {
  if (input.length > 3) {
    return input.toUpperCase();
  }
  return input.trim().padEnd(4, "-");
}
