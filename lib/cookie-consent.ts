// Cookie-consent state. Bound to a single first-party cookie so both the
// server (proxy.ts gating attribution writes) and the client (banner UI)
// read the same thing.
//
// Deliberately not "server-only": imported by both proxy.ts and the
// browser banner. Cookie names referenced by name in `clearMarketing`
// rather than imported from lib/attribution.ts because that module is
// server-only.

export const CONSENT_COOKIE = "cookie_consent";

// ICO + CNIL guidance: consent expires after ~12 months, after which the
// banner must reappear.
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

// Schema version. Bump when categories change — or when the way a stored
// record came to be changes — to invalidate stored consents: a record of any
// other version parses to null, so the banner asks again and every marketing
// loader, gate and server read treats the visitor as undecided (= off).
// 2 since #466 (2026-10-19): until then proxy.ts wrote `marketing:true` by
// itself outside the EU/EEA/UK/CH, and those v1 records cannot be told apart
// from an explicit «Accept all» — so every v1 record is asked again, once.
export const CONSENT_VERSION = 2;

export type ConsentRecord = {
  necessary: true;
  marketing: boolean;
  ts: number;
  v: typeof CONSENT_VERSION;
};

export function parseConsent(raw: string | undefined): ConsentRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.v === CONSENT_VERSION &&
      typeof parsed.marketing === "boolean"
    ) {
      return {
        necessary: true,
        marketing: parsed.marketing,
        ts: typeof parsed.ts === "number" ? parsed.ts : 0,
        v: CONSENT_VERSION,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function hasMarketingConsent(raw: string | undefined): boolean {
  return parseConsent(raw)?.marketing === true;
}

// No geo branch (#466): consent for marketing cookies is asked of every
// visitor, in every country — nothing writes a default record, and unknown or
// missing geo changes nothing because geo is not read at all.

export function serializeConsent(c: ConsentRecord): string {
  return JSON.stringify(c);
}

// Client-side helpers. Guarded so server bundles importing this file don't
// crash — they just no-op.

export function readConsentFromDocument(): ConsentRecord | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=([^;]+)`),
  );
  return parseConsent(match ? decodeURIComponent(match[1]) : undefined);
}

export function writeConsentToDocument(c: ConsentRecord): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(serializeConsent(c));
  const isSecure =
    typeof window !== "undefined" && window.location.protocol === "https:";
  document.cookie =
    `${CONSENT_COOKIE}=${value}` +
    `; max-age=${CONSENT_MAX_AGE_SECONDS}` +
    `; path=/` +
    `; samesite=lax` +
    (isSecure ? "; secure" : "");
}

// Clear any cookies we previously set under marketing-category consent.
// Cookie names hardcoded — lib/attribution.ts / lib/capi-identity.ts are
// server-only and can't be imported here. Keep in sync if those names change.
// `_fbp` / `_fbc` are the Meta Pixel's marketing cookies — `_fbp` is set by
// fbevents.js scoped to the registrable domain (Domain=.matio.tv), so a
// path-only deletion (which only matches a HOST-ONLY cookie) won't remove it.
// We therefore expire each name BOTH host-only and domain-scoped.
export function clearMarketingCookies(): void {
  if (typeof document === "undefined") return;
  // Registrable domain from the current host (e.g. www.matio.tv → matio.tv).
  // Naive last-two-labels is correct for a simple TLD like .tv; skipped on
  // localhost (no dot), where there is no domain-scoped cookie to clear.
  const labels = window.location.hostname.split(".");
  const root = labels.length >= 2 ? labels.slice(-2).join(".") : null;
  // `__oppref` is the ChatGPT Ads pixel's click identifier — the OpenAI
  // counterpart of `_fbc` (host-only, path=/, lifetime set by OpenAI).
  // `muxData` is Mux Data's viewer-id cookie (host-only, path=/, written by
  // mux-embed while a consented view is being monitored). Listed under
  // Marketing on /cookies, so a withdrawal has to take it with it — the watch
  // player stops the monitor itself but never touches cookies (#127);
  // `mux_viewer_id` is the other name /cookies gives it.
  //
  // The SDKs that name their cookies after a key are matched by pattern on
  // what the browser actually holds: GA4's `_ga` + `_ga_<container>` (up to
  // two years, on the registrable domain) and PostHog's `ph_<key>_posthog`.
  // Since #466 «Essential only» is the one thing that cleans a browser left
  // with them by the old geo default — once a visitor says no, neither SDK
  // loads again to remove its own.
  const held = document.cookie
    .split(";")
    .map((pair) => pair.split("=")[0].trim())
    .filter((name) => /^_ga(_.+)?$/.test(name) || /^ph_.+_posthog$/.test(name));
  for (const name of [
    "attribution_first",
    "attribution_last",
    "_fbp",
    "_fbc",
    "__oppref",
    "muxData",
    "mux_viewer_id",
    ...held,
  ]) {
    document.cookie = `${name}=; max-age=0; path=/`;
    if (root) document.cookie = `${name}=; max-age=0; path=/; domain=.${root}`;
  }
}

// A `cookie_consent` the browser holds that no longer parses — a record of an
// older version (the v1 records proxy.ts wrote by itself outside Europe until
// #466) or a damaged one. The visitor is undecided again, and whatever the old
// record let in is still sitting in the browser: `attribution_first` and
// `_fbc` are write-if-absent, so a pair from the geo-default era would
// otherwise outrank the visitor's real first touch once they press «Accept
// all». The banner clears the marketing cookies once when it finds one.
export function hasStaleConsentRecord(): boolean {
  if (typeof document === "undefined") return false;
  const present = new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=[^;]`).test(document.cookie);
  return present && readConsentFromDocument() === null;
}

// Custom event the SiteFooter dispatches when the user clicks "Cookie
// preferences" — the banner listens and re-opens.
export const COOKIE_PREFS_EVENT = "matio:open-cookie-preferences";

// Custom event the banner dispatches when the user makes (or changes) a
// consent decision. Distinct from COOKIE_PREFS_EVENT ("reopen the banner") —
// this one carries the new marketing boolean so consent-aware components
// (the Meta Pixel loader) can start or stop tracking without a full reload.
export const CONSENT_CHANGED_EVENT = "matio:consent-changed";

export function broadcastConsentChange(marketing: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CONSENT_CHANGED_EVENT, { detail: { marketing } }),
  );
}
