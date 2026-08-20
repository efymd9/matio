import { INK_DIM, INK_MUTED, PALETTE, TONE_STOPS, toneFor } from "@/shared/design";

// React-Native-shaped theme derived from the web's brand tokens. Nothing here
// re-declares a colour — every value traces back to lib/design.ts, which in
// turn mirrors app/globals.css.

export const colors = {
  bg: PALETTE.espresso,
  card: PALETTE.espresso2,
  ink: PALETTE.cream,
  inkMuted: INK_MUTED,
  inkDim: INK_DIM,
  gold: PALETTE.gold,
  goldHi: PALETTE.goldHi,
  goldLo: PALETTE.goldLo,
  goldDeep: PALETTE.goldDeep,
  burgundy: PALETTE.burgundy,
  rust: PALETTE.rust,
  // Translucent cream, used by the 8a header pills and circular controls.
  glass: "rgba(246,239,228,0.08)",
  hairline: "rgba(168,64,31,0.3)",
} as const;

// The 8a spec's 4px base rhythm.
export const space = (n: number) => n * 4;

// Screen padding: 20–24px on mobile per the 8a spec.
export const SCREEN_PAD = 20;

// Radii — CTAs and pills are fully rounded (an explicit design decision);
// cards and posters sit at 14–16.
export const radius = { pill: 999, card: 16, poster: 14 } as const;

// The 8a type system: Anton for display, Geist for UI/body, Geist Mono for
// timecodes. Loaded in app/_layout.tsx — these names must match the exports
// imported there or text silently falls back to the system face.
export const fonts = {
  display: "Anton_400Regular",
  body: "Geist_400Regular",
  bodySemi: "Geist_600SemiBold",
  mono: "GeistMono_400Regular",
} as const;

// Anton is a single-weight face. Deliberately NO fontWeight here: pairing a
// weight with a custom family makes iOS synthesise a bolder face (or fall back
// entirely), which is exactly how a brand font quietly stops rendering.
export const display = {
  fontFamily: fonts.display,
  textTransform: "uppercase",
  letterSpacing: 0.5,
} as const;

export const body = { fontFamily: fonts.body } as const;

// Deterministic fallback gradient for missing artwork — same hash as the web,
// so a show without a poster looks identical on both surfaces.
export function toneStopsFor(key: string): readonly [string, string] {
  return TONE_STOPS[toneFor(key)];
}
