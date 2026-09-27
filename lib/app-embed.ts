// The legal documents as the app shows them (#310).
//
// The Expo app opens /terms, /privacy and /cookies (and their /es twins) in an
// in-app browser. The full site page carries the header, and in paid mode the
// header's «Subscribe» link leads to a Stripe purchase outside the App Store
// (guideline 3.1.1). Outside the EU/EEA/UK/CH the same page also loads the
// consent-gated trackers (Meta Pixel, GA4, PostHog, OpenAI) with no banner.
// With `?embed=app` the page is the document and nothing else: proxy.ts sees
// the parameter on exactly these paths and stamps APP_EMBED_HEADER on the
// request, and the root layout then renders only the page — no header, footer,
// cookie banner, tracker loaders or visit beacon.
//
// Universal and import-free: proxy.ts, the layout, the legal pages,
// /v1/config and the app (through mobile/src/shared/app-embed.ts, the same
// relative re-export as lib/seo.ts) all read it.

export const APP_EMBED_PARAM = "embed";
export const APP_EMBED_VALUE = "app";

// Set by proxy.ts only — the layout and the pages read it, the URL never
// reaches them (a layout gets no searchParams).
export const APP_EMBED_HEADER = "x-matio-embed";

// Only the three legal documents have an embed variant. Base (English) paths:
// the /es prefix is stripped before this is asked.
const EMBEDDABLE_PATHS: ReadonlySet<string> = new Set([
  "/terms",
  "/privacy",
  "/cookies",
]);

export function isAppEmbedRequest(
  basePath: string,
  searchParams: URLSearchParams,
): boolean {
  return (
    EMBEDDABLE_PATHS.has(basePath) &&
    searchParams.get(APP_EMBED_PARAM) === APP_EMBED_VALUE
  );
}

// The embed variant of a path that carries no query of its own.
export function withAppEmbed(path: string): string {
  return `${path}?${APP_EMBED_PARAM}=${APP_EMBED_VALUE}`;
}
