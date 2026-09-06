import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import {
  BURGUNDY_GLOW,
  DUOTONE_GRADIENT,
  GOLD_GLOW,
  HERO_SCRIM_BOTTOM,
  HERO_SCRIM_SIDE,
  OG_NO_ART_GLOW,
  OG_PHOTO_SCRIM,
  SHOW_HERO_SCRIM,
  WALL_SCRIM,
} from "@/lib/design";

import { golden } from "./golden";

// The design system on one page: what a feature is allowed to reach for.
// Nothing here is a component — these stories render the tokens themselves, so
// "which gold is the hover state" is answered by looking rather than by
// grepping globals.css.
//
// Adding a token? Add it here in the same PR, or the sheet stops being the
// answer and people start inventing values again.
const meta = {
  title: "Lab/Design tokens",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const BRAND: { name: string; className: string; hex: string; use: string }[] = [
  { name: "espresso", className: "bg-espresso", hex: "#0f0a07", use: "Page background" },
  { name: "espresso-2", className: "bg-espresso-2", hex: "#1a120c", use: "Raised surfaces, cards" },
  { name: "cream", className: "bg-cream", hex: "#f6efe4", use: "Body text on dark" },
  { name: "gold", className: "bg-gold", hex: "#e6b366", use: "Primary accent, CTAs" },
  { name: "gold-hi", className: "bg-gold-hi", hex: "#eec489", use: "Hover / highlight" },
  { name: "gold-lo", className: "bg-gold-lo", hex: "#dfa557", use: "Pressed / shadow side" },
  { name: "gold-deep", className: "bg-gold-deep", hex: "#241205", use: "Text ON gold" },
  { name: "burgundy", className: "bg-burgundy", hex: "#8f2f1c", use: "Secondary brand" },
  { name: "rust", className: "bg-rust", hex: "#a8401f", use: "Warm accent, borders at /30" },
  { name: "umber", className: "bg-umber", hex: "#5c2416", use: "Deep gradient partner for burgundy (press-contact band)" },
];

export const Colors: Story = {
  play: async ({ canvasElement }) => golden(canvasElement, "tokens-colors"),
  render: () => (
    <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
      {BRAND.map((token) => (
        <div key={token.name} className="flex items-center gap-4 rounded-xl bg-espresso-2 p-3">
          <div className={`size-14 shrink-0 rounded-lg ${token.className}`} />
          <div className="min-w-0">
            <div className="font-mono text-sm text-cream">{token.name}</div>
            <div className="font-mono text-xs text-cream/50">{token.hex}</div>
            <div className="text-xs text-cream/70">{token.use}</div>
          </div>
        </div>
      ))}
    </div>
  ),
};

// Shadows: box-shadow tokens (`--shadow-*` in @theme → `shadow-<name>`),
// named by ROLE — the eight values did not collapse into fewer families
// without moving a pixel. A feature never writes `shadow-[…]` (the style gate
// rejects it); a new elevation is a new row here and in globals.css, same PR.
//
// `literal` is the exact arbitrary value each token replaced in #31, kept as
// the reference: the story renders both and the play function asserts the
// COMPUTED box-shadow is identical. The golden compares pixels at 0.1%; this
// compares the CSS itself and names the token that drifted.
const SHADOWS: {
  name: string;
  literal: string;
  gold: boolean;
  use: string;
}[] = [
  {
    name: "shadow-cta",
    literal: "shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)]",
    gold: true,
    use: "Gold pill CTA — Play, Subscribe, Notify me, Back",
  },
  {
    name: "shadow-play",
    literal: "shadow-[0_20px_50px_-16px_rgba(230,179,102,0.6)]",
    gold: true,
    use: "Big round play / pause button on the player",
  },
  {
    name: "shadow-card",
    literal: "shadow-[0_14px_30px_-14px_rgba(0,0,0,0.8)]",
    gold: false,
    use: "Rail tiles — continue watching, just released",
  },
  {
    name: "shadow-poster",
    literal: "shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)]",
    gold: false,
    use: "Top-3 poster",
  },
  {
    name: "shadow-popup",
    literal: "shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)]",
    gold: false,
    use: "Header menu, language dropdown",
  },
  {
    name: "shadow-hover-card",
    literal: "shadow-[0_20px_50px_rgba(0,0,0,0.6)]",
    gold: false,
    use: "Actor hover card",
  },
  {
    name: "shadow-sheet",
    literal: "shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
    gold: false,
    use: "Up-next corner sheet",
  },
  {
    name: "shadow-dialog",
    literal: "shadow-[0_20px_80px_rgba(0,0,0,0.5)]",
    gold: false,
    use: "Series-end dialog",
  },
];

export const Shadows: Story = {
  play: async ({ canvasElement }) => {
    for (const token of SHADOWS) {
      const tile = (kind: "token" | "literal") =>
        canvasElement.querySelector<HTMLElement>(
          `[data-shadow="${token.name}"][data-kind="${kind}"]`,
        );
      const mine = getComputedStyle(tile("token")!).boxShadow;
      await expect(mine, token.name).not.toBe("none");
      await expect(mine, token.name).toBe(
        getComputedStyle(tile("literal")!).boxShadow,
      );
    }
    await golden(canvasElement, "tokens-shadows");
  },
  render: () => (
    <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
      {SHADOWS.map((token) => {
        const surface = token.gold
          ? "bg-gold-cta"
          : "border border-rust/30 bg-espresso-2";
        return (
          <div
            key={token.name}
            className="flex items-center gap-5 rounded-xl bg-espresso p-5"
          >
            <div
              data-shadow={token.name}
              data-kind="token"
              className={`size-16 shrink-0 rounded-2xl ${surface} ${token.name}`}
            />
            <div
              data-shadow={token.name}
              data-kind="literal"
              className={`size-16 shrink-0 rounded-2xl ${surface} ${token.literal}`}
            />
            <div className="min-w-0">
              <div className="font-mono text-sm text-cream">{token.name}</div>
              <div className="font-mono text-xs text-cream/50">
                {token.literal.slice("shadow-[".length, -1).replaceAll("_", " ")}
              </div>
              <div className="text-xs text-cream/70">{token.use}</div>
            </div>
          </div>
        );
      })}
    </div>
  ),
};

// Gradients live in lib/design.ts, not in @theme: they carry alpha stops the
// utilities cannot express, and the OG image runs through Satori, which has no
// CSS variables. `literal` is the inline-style string each constant replaced
// in #31 — the play function pins the constant to it, so the sheet fails by
// name if a scrim ever drifts.
const GRADIENTS: {
  name: string;
  value: string;
  literal: string;
  base: string;
  use: string;
}[] = [
  {
    name: "HERO_SCRIM_BOTTOM",
    value: HERO_SCRIM_BOTTOM,
    literal:
      "linear-gradient(to top, #0f0a07 4%, rgba(15,10,7,0.4) 40%, transparent 66%)",
    base: "bg-gold-lo",
    use: "Home hero — fade into the page background",
  },
  {
    name: "HERO_SCRIM_SIDE",
    value: HERO_SCRIM_SIDE,
    literal:
      "linear-gradient(to right, rgba(15,10,7,0.85), rgba(15,10,7,0.35), transparent)",
    base: "bg-gold-lo",
    use: "Home hero — left column behind the copy (tablet / desktop)",
  },
  {
    name: "SHOW_HERO_SCRIM",
    value: SHOW_HERO_SCRIM,
    literal:
      "linear-gradient(to top, #0f0a07 4%, rgba(15,10,7,0.4) 45%, transparent 70%)",
    base: "bg-gold-lo",
    use: "Show page hero backdrop",
  },
  {
    name: "WALL_SCRIM",
    value: WALL_SCRIM,
    literal:
      "linear-gradient(to top, rgba(15,10,7,0.97) 30%, rgba(15,10,7,0.55) 60%, rgba(15,10,7,0.25) 100%)",
    base: "bg-gold-lo",
    use: "Paywall and signup wall over the dimmed artwork",
  },
  {
    name: "GOLD_GLOW",
    value: GOLD_GLOW,
    literal:
      "radial-gradient(circle at 50% 50%, rgba(230,179,102,0.25), transparent 60%)",
    base: "bg-espresso-2",
    use: "Artwork stand-in on episode thumbnails (episodes overlay, up-next)",
  },
  {
    name: "BURGUNDY_GLOW",
    value: BURGUNDY_GLOW,
    literal:
      "radial-gradient(circle at 50% 0%, rgba(143,47,28,0.4), transparent 60%)",
    base: "bg-espresso-2",
    use: "Series-end dialog — glow from the top edge",
  },
  {
    name: "DUOTONE_GRADIENT",
    value: DUOTONE_GRADIENT,
    literal: "linear-gradient(160deg, rgba(230,179,102,0.2), rgba(143,47,28,0.3))",
    base: "bg-espresso-2",
    use: "Duotone tint — inline twin of .duotone for the OG image",
  },
  {
    name: "OG_PHOTO_SCRIM",
    value: OG_PHOTO_SCRIM,
    literal:
      "linear-gradient(180deg, rgba(15,10,7,0.15) 0%, rgba(15,10,7,0.6) 55%, rgba(15,10,7,0.97) 100%)",
    base: "bg-gold-lo",
    use: "OpenGraph card — legibility scrim over a photo (Satori)",
  },
  {
    name: "OG_NO_ART_GLOW",
    value: OG_NO_ART_GLOW,
    literal:
      "radial-gradient(circle at 26% 20%, rgba(230,179,102,0.16), transparent 55%), radial-gradient(ellipse at 50% 115%, rgba(143,47,28,0.45), transparent 55%)",
    base: "bg-espresso",
    use: "OpenGraph card — glow pair when the show has no artwork (Satori)",
  },
];

export const Gradients: Story = {
  play: async ({ canvasElement }) => {
    for (const token of GRADIENTS) {
      await expect(token.value, token.name).toBe(token.literal);
    }
    await golden(canvasElement, "tokens-gradients");
  },
  render: () => (
    <div className="grid grid-cols-1 gap-4">
      {GRADIENTS.map((token) => (
        <div
          key={token.name}
          className="flex items-center gap-5 rounded-xl bg-espresso-2 p-3"
        >
          <div
            className={`relative h-20 w-40 shrink-0 overflow-hidden rounded-xl ${token.base}`}
          >
            <div
              className="absolute inset-0"
              style={{ backgroundImage: token.value }}
            />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-sm text-cream">{token.name}</div>
            <div className="font-mono text-xs break-words text-cream/50">
              {token.value}
            </div>
            <div className="text-xs text-cream/70">{token.use}</div>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Typography: Story = {
  play: async ({ canvasElement }) => golden(canvasElement, "tokens-typography"),
  render: () => (
    <div className="space-y-6 text-cream">
      <div>
        <div className="mb-2 font-mono text-xs text-cream/50">
          --font-display (Anton) — titles and section headers, uppercase at call sites
        </div>
        <p className="font-display text-4xl uppercase tracking-wide">Thunder Lady</p>
      </div>
      <div>
        <div className="mb-2 font-mono text-xs text-cream/50">
          --font-sans (Geist) — everything else
        </div>
        <p className="text-base">
          Una serie original de Matio. The quick brown fox jumps over the lazy dog.
        </p>
        <p className="text-sm text-cream/70">
          Secondary text at 70% opacity — synopses, metadata, footer links.
        </p>
      </div>
      <div>
        <div className="mb-2 font-mono text-xs text-cream/50">
          --font-geist-mono — numbers in the admin dashboard
        </div>
        <p className="font-mono text-sm">1 284 visits · 38 registrations · 12.4%</p>
      </div>
    </div>
  ),
};

// The three widths the CSS actually switches on. A new element is checked at
// all three before it is approved — this story exists so "did you look at
// tablet?" has a one-click answer.
export const Breakpoints: Story = {
  render: () => (
    <div className="space-y-2 text-cream">
      <div className="rounded-lg bg-burgundy p-4 tablet:bg-rust xl:bg-gold xl:text-gold-deep">
        <span className="tablet:hidden">mobile — under 834px</span>
        <span className="hidden tablet:inline xl:hidden">tablet — 834px to 1279px</span>
        <span className="hidden xl:inline">desktop — 1280px and up</span>
      </div>
      <p className="text-xs text-cream/60">
        Resize the canvas, or use the viewport toolbar (Mobile 390 / Tablet 834 / Desktop 1280).
      </p>
    </div>
  ),
};
