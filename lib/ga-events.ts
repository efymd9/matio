// Client-side Google Analytics 4 helpers. Safe to import anywhere: every track
// call is a no-op until the consent-gated loader (components/site/google-
// analytics.tsx) has injected gtag.js and defined window.gtag. That keeps the
// marketing-consent gate in ONE place — call sites just call trackGA() without
// re-checking consent. Same philosophy as lib/meta-pixel-events.ts /
// lib/posthog-events.ts. No SDK / npm package — we inject gtag.js directly,
// exactly like the Meta Pixel injects fbevents.js.

// GA4 Measurement ID (format "G-XXXXXXXXXX"). Blank → GA is fully off (the
// loader renders nothing), mirroring the META_PIXEL_IDS / POSTHOG_KEY gates.
export const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";

// Dispatched by the loader once gtag.js + the initial config have run. Mirrors
// meta-pixel's PIXEL_READY_EVENT / posthog's POSTHOG_READY_EVENT so mount-time
// events don't fire into a not-yet-loaded gtag and get dropped.
export const GA_READY_EVENT = "matio:ga-ready";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
    dataLayer?: unknown[];
    __gaReady?: boolean;
  }
}

// Consent Mode v2 signals. We only ever INJECT gtag.js after marketing consent,
// so "granted" is the state at load; the loader flips these to "denied" via a
// `consent: 'update'` if the visitor withdraws mid-session (gtag, like fbq,
// can't be unloaded once injected).
export const GA_CONSENT_GRANTED = {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
} as const;

export const GA_CONSENT_DENIED = {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
} as const;

// Fire a custom GA4 event. No-op until gtag.js has loaded (no consent → never
// loads → never fires, the desired consent-respecting behaviour).
export function trackGA(event: string, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("event", event, params ?? {});
}

// GA4's documented runtime kill-switch: setting window['ga-disable-<ID>'] to
// true makes gtag.js stop sending ALL hits for that Measurement ID (including
// the otherwise-unstoppable Consent Mode "ping" beacons). This is the closest
// gtag equivalent to fbq('consent','revoke') — Consent Mode 'denied' ALONE only
// drops cookies + identifiers, it keeps beaconing anonymized pings. We toggle
// this alongside Consent Mode on withdrawal/re-grant so a mid-session opt-out
// genuinely halts transmission, not just cookie storage. (gtag.js, like
// fbevents.js, can't be unmounted once injected — this is the real stop.)
export function setGaDisabled(disabled: boolean): void {
  if (typeof window === "undefined" || !GA_MEASUREMENT_ID) return;
  (window as unknown as Record<string, boolean>)[
    `ga-disable-${GA_MEASUREMENT_ID}`
  ] = disabled;
}

// Run `cb` as soon as GA is loaded. Fires immediately if it already is;
// otherwise waits for GA_READY_EVENT. If GA never loads (no marketing consent)
// `cb` never runs. Returns a cleanup that detaches the listener.
export function onGAReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.__gaReady === true || typeof window.gtag === "function") {
    cb();
    return () => {};
  }
  const handler = () => cb();
  window.addEventListener(GA_READY_EVENT, handler, { once: true });
  return () => window.removeEventListener(GA_READY_EVENT, handler);
}
