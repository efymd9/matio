// Pages that load NO advertising pixel — the Meta Pixel and Google Analytics 4
// (#376, the owner's option (а)): `/careers` carries a form with a candidate's
// name and email, and whether Meta's Automatic Advanced Matching or GA4's
// automatic user-provided-data detection is on is still unconfirmed (#341) —
// either would read those fields past every gate in our code. Until #341 is
// closed, the page simply does not get the two loaders. Consent is untouched
// (proxy.ts still writes the cookie_consent default and the attribution
// cookies), and PostHog and the ChatGPT Ads pixel stay as they are.
//
// The mechanism is the `?embed=app` one (lib/app-embed.ts): proxy.ts stamps
// AD_PIXELS_HEADER on the request for these paths, and the root layout skips
// <MetaPixel> and <GoogleAnalytics> when it sees it. A layout renders on a
// document load only, so the footer's link to /careers is a plain <a> — a
// client-side navigation would reach the page inside a document whose layout
// already mounted the pixels.
//
// Universal and import-free: proxy.ts and the layout both read it.

export const AD_PIXELS_HEADER = "x-matio-ad-pixels";
export const AD_PIXELS_OFF = "off";

// Exact bare paths (an /es URL is redirected away before this is asked).
const AD_PIXEL_FREE_PATHS: ReadonlySet<string> = new Set(["/careers"]);

export function adPixelsOffFor(basePath: string): boolean {
  return AD_PIXEL_FREE_PATHS.has(basePath);
}
