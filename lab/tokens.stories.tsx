import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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
