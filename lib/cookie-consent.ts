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

// Schema version. Bump when categories change to invalidate stored
// consents that no longer cover the current cookie set.
export const CONSENT_VERSION = 1;

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

// Countries where opt-in consent for marketing cookies is legally required:
// the EU/EEA + UK + Switzerland. ISO 3166-1 alpha-2. Everywhere else (the
// Americas, etc.) we default marketing consent ON and skip the banner — the
// gating happens in proxy.ts off the Vercel `x-vercel-ip-country` header.
export const CONSENT_REQUIRED_COUNTRIES = new Set([
  // EU 27
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // EEA (non-EU) + UK + Switzerland
  "IS", "LI", "NO", "GB", "CH",
]);

// Is an opt-in marketing-consent banner required for this country? Fails
// CLOSED (treated as required) for missing / empty / malformed geo — a value
// that isn't a clean ISO-3166-1 alpha-2 code is treated as "unknown", so we
// never default tracking on for a visitor we can't confidently place.
export function marketingConsentRequired(
  country: string | null | undefined,
): boolean {
  const c = country?.toUpperCase();
  if (!c || !/^[A-Z]{2}$/.test(c)) return true;
  return CONSENT_REQUIRED_COUNTRIES.has(c);
}

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
  for (const name of ["attribution_first", "attribution_last", "_fbp", "_fbc"]) {
    document.cookie = `${name}=; max-age=0; path=/`;
    if (root) document.cookie = `${name}=; max-age=0; path=/; domain=.${root}`;
  }
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
