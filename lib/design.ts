// Shared design tokens for the gold-duotone Matio look (redesign 8a).
// Mirrors the brand palette in app/globals.css so posters and hero
// gradients stay visually consistent across the app.

export type Tone = "a" | "b" | "c" | "d" | "e" | "f";

export const TONE_KEYS: Tone[] = ["a", "b", "c", "d", "e", "f"];

// Curated warm gradients used as a stand-in whenever artwork is missing.
// All in the espresso/rust family; the first three come straight from the
// design's fallback posters. Keep in sync with the .tone-* utilities in
// globals.css.
export const TONE_GRADIENT: Record<Tone, string> = {
  a: "linear-gradient(160deg, #5c2416 0%, #170905 100%)",
  b: "linear-gradient(160deg, #4a2c12 0%, #140a04 100%)",
  c: "linear-gradient(160deg, #58321c 0%, #170b05 100%)",
  d: "linear-gradient(160deg, #4d1f2a 0%, #150710 100%)",
  e: "linear-gradient(160deg, #3f2a18 0%, #120b04 100%)",
  f: "linear-gradient(160deg, #33201a 0%, #0f0806 100%)",
};

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
