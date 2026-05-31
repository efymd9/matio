// Client-side Meta Pixel helpers. Safe to import anywhere: every track call
// is a no-op until the consent-gated loader (components/site/meta-pixel.tsx)
// has injected fbevents.js. That keeps the marketing-consent gate in ONE
// place — individual call sites just call trackPixel() without re-checking
// consent themselves.

// Primary pixel — also the one the server-side Conversions API (lib/meta-capi.ts)
// sends Purchase to, since CAPI needs a per-pixel access token.
export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? "";

// Every browser pixel to initialize: the primary above + any extras listed
// comma-separated in NEXT_PUBLIC_META_PIXEL_IDS. fbq('track', …) with no pixel
// argument fires to ALL init'd pixels, so every call site hits every pixel with
// no further changes. NOTE: extra pixels are BROWSER-ONLY — the server-side
// CAPI Purchase still goes only to META_PIXEL_ID unless an extra pixel is given
// its own CAPI access token.
export const META_PIXEL_IDS: string[] = Array.from(
  new Set(
    [META_PIXEL_ID, ...(process.env.NEXT_PUBLIC_META_PIXEL_IDS ?? "").split(",")]
      .map((id) => id.trim())
      .filter(Boolean),
  ),
);

// Set by the base snippet once fbq('init') + the first PageView have run.
// Used by onPixelReady() so mount-time events (ViewContent, registration)
// don't fire into a not-yet-loaded fbq and get dropped.
export const PIXEL_READY_EVENT = "mfbq:ready";

type Fbq = ((...args: unknown[]) => void) & {
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
  callMethod?: (...args: unknown[]) => void;
};

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
    __mfbqReady?: boolean;
  }
}

export type StandardEvent =
  | "PageView"
  | "ViewContent"
  | "Lead"
  | "InitiateCheckout"
  | "CompleteRegistration"
  | "Subscribe"
  | "Purchase";

// Membership price for top-of-funnel browser value signals. The authoritative
// amount for the server-side Purchase event is read from Stripe; this is only
// the hint attached to the browser ViewContent / InitiateCheckout events on
// the single $38/mo plan.
export const MEMBERSHIP_VALUE = 38;
export const MEMBERSHIP_CURRENCY = "USD";

export function trackPixel(
  event: StandardEvent,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  if (options?.eventID) {
    window.fbq("track", event, params ?? {}, { eventID: options.eventID });
  } else {
    window.fbq("track", event, params ?? {});
  }
}

// Run `cb` as soon as the pixel is loaded. Fires immediately if it already is;
// otherwise waits for PIXEL_READY_EVENT (dispatched by the loader's base
// snippet). If the pixel never loads (no marketing consent) `cb` never runs —
// which is the desired behaviour for events that must respect consent.
// Returns a cleanup that detaches the listener.
export function onPixelReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.__mfbqReady === true || typeof window.fbq === "function") {
    cb();
    return () => {};
  }
  const handler = () => cb();
  window.addEventListener(PIXEL_READY_EVENT, handler, { once: true });
  return () => window.removeEventListener(PIXEL_READY_EVENT, handler);
}
