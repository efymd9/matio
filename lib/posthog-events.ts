// Client-side PostHog helpers. Safe to import anywhere: every capture call is
// a no-op until the consent-gated provider (components/site/posthog-provider.tsx)
// has dynamically loaded posthog-js and assigned window.posthog. That keeps the
// marketing-consent gate in ONE place — call sites just call capturePostHog()
// without re-checking consent. We deliberately do NOT import posthog-js here so
// the SDK stays out of every call site's bundle (it loads once, in the provider).

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "/ingest";

// Dispatched by the provider once posthog-js has finished loading + init.
// Mirrors meta-pixel's PIXEL_READY_EVENT so mount-time events (paywall_shown,
// show_viewed, signup_completed) don't fire into a not-yet-loaded SDK.
export const POSTHOG_READY_EVENT = "matio:ph-ready";

// Curated funnel events. Page-level steps (/, /shows/*, /subscribe) come from
// $pageview path filters, not named events.
export type FunnelEvent =
  | "show_viewed"
  | "trial_play_started"
  | "paywall_shown"
  | "signup_cta_clicked"
  | "signup_completed"
  | "checkout_started";

// Minimal surface we use. The provider assigns the real posthog-js instance
// (which is structurally compatible) to window.posthog after init.
type PostHogClient = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (distinctId: string, properties?: Record<string, unknown>) => void;
  reset: () => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
};

declare global {
  interface Window {
    posthog?: PostHogClient;
    __phReady?: boolean;
  }
}

export function capturePostHog(
  event: FunnelEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  window.posthog?.capture(event, properties);
}

// Run `cb` as soon as PostHog is loaded. Fires immediately if it already is;
// otherwise waits for POSTHOG_READY_EVENT. If PostHog never loads (no marketing
// consent) `cb` never runs — the desired behaviour for consent-respecting
// mount events. Returns a cleanup that detaches the listener.
export function onPostHogReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.__phReady === true) {
    cb();
    return () => {};
  }
  const handler = () => cb();
  window.addEventListener(POSTHOG_READY_EVENT, handler, { once: true });
  return () => window.removeEventListener(POSTHOG_READY_EVENT, handler);
}
