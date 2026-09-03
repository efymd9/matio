// Client-side helpers for the ChatGPT Ads Measurement Pixel (OpenAI's `oaiq`
// SDK). Safe to import anywhere: every measure call is a no-op until the
// consent-gated loader (components/site/openai-pixel.tsx) has injected the SDK
// and defined window.oaiq. That keeps the marketing-consent gate in ONE place —
// call sites just call measureOaiq() without re-checking consent. Same
// philosophy as lib/meta-pixel-events.ts / lib/ga-events.ts. No npm SDK — the
// loader injects oaiq.min.js directly, exactly like fbevents.js / gtag.js.

// Pixel ID from the OpenAI Ads Manager. PUBLIC (ships in client JS). Blank →
// the pixel is fully off (the loader renders nothing), mirroring the
// META_PIXEL_IDS / GA_MEASUREMENT_ID gates. NEXT_PUBLIC is build-time inlined.
export const OPENAI_PIXEL_ID = process.env.NEXT_PUBLIC_OPENAI_PIXEL_ID ?? "";

// Script host + the SDK URL from OpenAI's snippet. Events go to
// bzr.openai.com; per-pixel config is fetched from bzrcdn.openai.com.
export const OAIQ_SDK_SRC = "https://bzrcdn.openai.com/sdk/oaiq.min.js";

// Dispatched by the loader once the SDK snippet + oaiq('init') have run.
// Mirrors meta-pixel's PIXEL_READY_EVENT / GA_READY_EVENT so mount-time
// conversions don't fire into a not-yet-loaded queue and get dropped.
export const OAIQ_READY_EVENT = "matio:oaiq-ready";

// OpenAI's standard event taxonomy (developers.openai.com/ads/measurement-
// pixel). Each event name is bound to exactly one `type`; the SDK rejects
// undocumented fields, so params are typed to the documented set.
export type OaiqEvent =
  | "page_viewed"
  | "contents_viewed"
  | "lead_created"
  | "registration_completed"
  | "subscription_created"
  | "trial_started";

export type OaiqParams = {
  type: "contents" | "customer_action" | "plan_enrollment";
  plan_id?: string;
  amount?: number;
  currency?: string;
};

export type OaiqOptions = {
  // Browser/server deduplication key — the same value sent through a future
  // Conversions API call collapses into one conversion.
  event_id?: string;
  // Measure the conversion but opt the user out of ads personalization.
  opt_out?: boolean;
};

type Oaiq = ((...args: unknown[]) => void) & { q?: unknown[] };

declare global {
  interface Window {
    oaiq?: Oaiq;
    __oaiqReady?: boolean;
  }
}

// Fire a standard measurement event. No-op until the SDK has loaded (no
// consent → never loads → never fires — the desired consent-respecting
// behaviour).
export function measureOaiq(
  event: OaiqEvent,
  params: OaiqParams,
  options?: OaiqOptions,
): void {
  if (typeof window === "undefined" || typeof window.oaiq !== "function") return;
  if (options) {
    window.oaiq("measure", event, params, options);
  } else {
    window.oaiq("measure", event, params);
  }
}

// Run `cb` as soon as the pixel is loaded. Fires immediately if it already is;
// otherwise waits for OAIQ_READY_EVENT (dispatched by the loader's snippet).
// If the pixel never loads (no marketing consent) `cb` never runs. Returns a
// cleanup that detaches the listener.
export function onOaiqReady(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (window.__oaiqReady === true || typeof window.oaiq === "function") {
    cb();
    return () => {};
  }
  const handler = () => cb();
  window.addEventListener(OAIQ_READY_EVENT, handler, { once: true });
  return () => window.removeEventListener(OAIQ_READY_EVENT, handler);
}
