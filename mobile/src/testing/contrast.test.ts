import { describe, expect, it } from "vitest";
import { colors } from "@/theme";
import { AA_TEXT, contrastRatio, over, parseColor } from "./contrast";

// #314 — the contrast table of the PR, computed from theme.ts rather than
// typed in. The three screens' own tests assert that each text RENDERS in the
// token named here; this file asserts that the token, on the background the
// text actually sits on, clears AA — and that the rust it replaced did not.

describe("the WCAG contrast helper", () => {
  it("agrees with WCAG's reference points", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#0f0a07", "#0f0a07")).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes AA on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(AA_TEXT);
  });

  it("reads jsdom's computed spellings and theme.ts tokens alike", () => {
    expect(parseColor("rgb(246, 239, 228)")).toEqual(parseColor(colors.ink));
    expect(parseColor("rgba(246, 239, 228, 0.5)")).toEqual(parseColor(colors.inkDim));
    expect(() => parseColor("cream")).toThrow("unparseable colour");
  });

  it("composites a translucent text over its background first", () => {
    expect(over(parseColor("rgba(255, 255, 255, 0.5)"), parseColor("#000000"))).toEqual({
      r: 127.5,
      g: 127.5,
      b: 127.5,
      a: 1,
    });
    expect(() => contrastRatio(colors.ink, colors.inkDim)).toThrow("background must be opaque");
  });
});

// Where each text sits: the sign-in error directly on the screen (espresso —
// the sign-in screen and the Account tab both paint `bg`); the episode
// duration and the danger rows inside a card (`card`, espresso-2).
const TABLE = [
  { text: "sign-in error", now: colors.ink, on: colors.bg, old: 3.2, fixed: 17.23 },
  { text: "episode duration (11pt mono)", now: colors.inkDim, on: colors.card, old: 3.01, fixed: 4.78 },
  { text: "danger row label", now: colors.ink, on: colors.card, old: 3.01, fixed: 16.19 },
] as const;

describe("#314 — every changed text clears AA on its real background", () => {
  for (const { text, now, on, old, fixed } of TABLE) {
    it(`${text}: ${fixed}:1 now, ${old}:1 in rust`, () => {
      expect(contrastRatio(now, on)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(now, on)).toBeCloseTo(fixed, 2);
      expect(contrastRatio(colors.rust, on)).toBeLessThan(AA_TEXT);
      expect(contrastRatio(colors.rust, on)).toBeCloseTo(old, 2);
    });
  }
});
