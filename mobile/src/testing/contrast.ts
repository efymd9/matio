// TEST-ONLY. WCAG 2.x contrast for the app's colour tokens (#314). Nothing in
// the app imports this file, so Metro never bundles it; it lives under
// src/ only so the tests can reach it through the `@/` alias.
//
// The math is WCAG's own: relative luminance of linearised sRGB, ratio
// (L1 + 0.05) / (L2 + 0.05). A translucent token (inkDim is cream at 50 %)
// is first composited over the background it is drawn on — that blend is
// the colour the eye actually gets.

export type Rgba = { r: number; g: number; b: number; a: number };

// The spellings the tests meet: theme.ts tokens ("#rrggbb", "rgba(…)") and
// what jsdom's getComputedStyle answers ("rgb(r, g, b)", "rgba(r, g, b, a)").
export function parseColor(css: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(
    css.trim(),
  );
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  throw new Error(`unparseable colour: ${css}`);
}

// Source-over onto an opaque background.
export function over(fg: Rgba, bg: Rgba): Rgba {
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  const lin = (channel: number) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// The ratio of `text` drawn on `background` (which must be opaque).
export function contrastRatio(text: string, background: string): number {
  const bg = parseColor(background);
  if (bg.a !== 1) throw new Error(`background must be opaque: ${background}`);
  const a = relativeLuminance(over(parseColor(text), bg));
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// For the rendered-tree tests (jsdom on react-native-web): the background a
// text is really drawn on — its own, or the nearest ancestor's that paints
// one. null = nothing in the rendered tree paints; the screen shows through.
export function paintedBackground(el: Element): string | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && parseColor(bg).a > 0) return bg;
  }
  return null;
}

// AA for normal-size text — every text in this app that is under 18pt
// (14pt bold), which is all three #314 fixed.
export const AA_TEXT = 4.5;
