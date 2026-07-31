// Shared design tokens for the gold-duotone Matio look (redesign 8a).
// Mirrors the brand palette in app/globals.css so posters and hero
// gradients stay visually consistent across the app.

export type Tone = "a" | "b" | "c" | "d" | "e" | "f";

export const TONE_KEYS: Tone[] = ["a", "b", "c", "d", "e", "f"];

// Curated warm gradients used as a stand-in whenever artwork is missing.
// All in the espresso/rust family; the first three come straight from the
// design's fallback posters. Keep in sync with the .tone-* utilities in
// globals.css.
//
// Stored as ordered COLOR STOPS rather than CSS strings because React Native
// has no CSS gradient syntax — the mobile app feeds these straight to
// expo-linear-gradient while the web consumes the TONE_GRADIENT strings built
// from them below. One source, two encodings; never hand-maintain both.
export const TONE_STOPS: Record<Tone, readonly [string, string]> = {
  a: ["#5c2416", "#170905"],
  b: ["#4a2c12", "#140a04"],
  c: ["#58321c", "#170b05"],
  d: ["#4d1f2a", "#150710"],
  e: ["#3f2a18", "#120b04"],
  f: ["#33201a", "#0f0806"],
};

export const TONE_GRADIENT: Record<Tone, string> = Object.fromEntries(
  TONE_KEYS.map((tone) => [
    tone,
    `linear-gradient(160deg, ${TONE_STOPS[tone][0]} 0%, ${TONE_STOPS[tone][1]} 100%)`,
  ]),
) as Record<Tone, string>;

// Deterministic tone from any stable string (a show id or slug).
// Same input → same tone, so the catalog reads consistently between renders.
export function toneFor(key: string): Tone {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return TONE_KEYS[Math.abs(hash) % TONE_KEYS.length];
}

// The signature duotone still treatment (gold → burgundy, blended with
// mix-blend-mode: overlay at the call site). Inline-style twin of the
// .duotone* utilities in globals.css for non-Tailwind render contexts
// (e.g. next/og ImageResponse).
export const DUOTONE_GRADIENT =
  "linear-gradient(160deg, rgba(230,179,102,0.2), rgba(143,47,28,0.3))";

export const ACCENT = "#e6b366";
export const BG = "#0f0a07";

// Full brand palette. Mirrors the CSS custom properties at the top of
// app/globals.css (--color-espresso … --color-rust) and is the source the
// mobile app imports — mobile/ resolves this file directly through Metro
// watchFolders, so the app never re-types a hex value. If a token changes in
// globals.css it must change here too.
export const PALETTE = {
  espresso: "#0f0a07",
  espresso2: "#1a120c",
  cream: "#f6efe4",
  gold: "#e6b366",
  goldHi: "#eec489",
  goldLo: "#dfa557",
  goldDeep: "#241205",
  burgundy: "#8f2f1c",
  rust: "#a8401f",
} as const;

// Cream at the two opacities the 8a spec uses for secondary/tertiary text.
// Pre-composed because React Native has no CSS color-mix equivalent.
export const INK_MUTED = "rgba(246,239,228,0.72)";
export const INK_DIM = "rgba(246,239,228,0.5)";
