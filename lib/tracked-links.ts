import { normalizeUtm, normalizeUtmSource } from "./utm";

// Pure helpers for the admin tracked-link generator (/admin/links).
// Deliberately NOT "server-only": the client form uses them for the live
// URL preview, and the server action uses them for the canonical insert —
// sharing one module means the preview can never drift from what's stored
// (same reasoning as lib/utm.ts).

// Matches lib/attribution.ts FIELD_MAX_LEN — values longer than this are
// truncated by the cookie pipeline, so a longer stored triple could never
// equal what a visitor's session gets stamped with.
export const UTM_MAX_LEN = 100;

export type UtmTriple = {
  source: string;
  medium: string;
  campaign: string;
};

// Canonicalize raw form input into the exact values the attribution
// pipeline would persist for a visitor who clicks the link. Returns
// undefined fields for values that normalize to nothing (symbols-only,
// empty) — the caller treats those as validation failures, because a link
// whose triple collapses to NULL lands in the "(direct)" bucket and is
// untrackable.
export function canonicalizeUtmTriple(raw: {
  source: string;
  medium: string;
  campaign: string;
}): Partial<UtmTriple> {
  return {
    source: normalizeUtmSource(raw.source)?.slice(0, UTM_MAX_LEN),
    medium: normalizeUtm(raw.medium)?.slice(0, UTM_MAX_LEN),
    campaign: normalizeUtm(raw.campaign)?.slice(0, UTM_MAX_LEN),
  };
}

// Site-relative landing path: absolute path, no scheme/host, no query or
// hash (the UTM query string is appended at render), no dot segments or
// protocol-relative "//" prefix. Lowercase-only: every route the app serves
// is lowercase (slugs are [a-z0-9-]) and App Router matching is
// case-sensitive with no case-normalizing redirect — an uppercase path
// would validate, store and copy cleanly, then 404 every visitor.
const TARGET_PATH_RE = /^\/(?!\/)[a-z0-9\-_/]*$/;

// Normalize raw custom-path input before validating/storing — pasted
// title-case ("/Watch/foo") should just work rather than error.
export function canonicalizeTargetPath(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidTargetPath(path: string): boolean {
  return path.length <= 200 && TARGET_PATH_RE.test(path) && !path.includes("..");
}

// The shareable URL. UTM values are already canonical ([a-z0-9_-] only), so
// they need no percent-encoding — keeping the URL byte-readable matters for
// social bios where it's pasted as visible text.
export function buildTrackedUrl(
  origin: string,
  targetPath: string,
  triple: UtmTriple,
): string {
  const base = `${origin}${targetPath === "/" ? "/" : targetPath}`;
  return `${base}?utm_source=${triple.source}&utm_medium=${triple.medium}&utm_campaign=${triple.campaign}`;
}
