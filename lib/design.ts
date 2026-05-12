// Shared design tokens for the cinema-red Matio look.
// Mirrors the curated palette from example_design/lib/shared.jsx so posters
// and hero gradients stay visually consistent across the app.

export type Tone = "a" | "b" | "c" | "d" | "e" | "f";

export const TONE_KEYS: Tone[] = ["a", "b", "c", "d", "e", "f"];

// Curated dark gradients used as a stand-in whenever artwork is missing.
// Keep in sync with the .tone-* utilities in globals.css.
export const TONE_GRADIENT: Record<Tone, string> = {
  a: "linear-gradient(160deg, #3a1f4d 0%, #0d0918 100%)",
  b: "linear-gradient(160deg, #1f3a4d 0%, #08121a 100%)",
  c: "linear-gradient(160deg, #4d3a1f 0%, #1a0e08 100%)",
  d: "linear-gradient(160deg, #1f4d3a 0%, #08180e 100%)",
  e: "linear-gradient(160deg, #4d1f3a 0%, #1a0814 100%)",
  f: "linear-gradient(160deg, #2a2a2e 0%, #0d0d10 100%)",
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

export const ACCENT = "#ff3d3d";
export const BG = "#0a0a0c";
