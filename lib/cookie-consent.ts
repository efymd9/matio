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
// Cookie names hardcoded — lib/attribution.ts is server-only and can't
// be imported here. Keep in sync if those names change.
export function clearMarketingCookies(): void {
  if (typeof document === "undefined") return;
  for (const name of ["attribution_first", "attribution_last"]) {
    document.cookie = `${name}=; max-age=0; path=/`;
  }
}

// Custom event the SiteFooter dispatches when the user clicks "Cookie
// preferences" — the banner listens and re-opens.
export const COOKIE_PREFS_EVENT = "matio:open-cookie-preferences";
