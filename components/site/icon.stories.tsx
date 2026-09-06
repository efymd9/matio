import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { Icon, type IconName } from "./icon";

// The stroke icon set the player, the walls and the detail page share. Colour
// is NOT a prop in a feature: the SVG inherits `currentColor`, so the parent's
// text token decides (`text-gold-deep` on a gold pill, `text-cream` on a
// burgundy badge), or `className="text-gold"` on the icon itself when a single
// glyph needs its own tone. That is what lets tools/qa/no-magic-styles.sh
// reject `color="#…"` in props (#31).
const NAMES: IconName[] = [
  "home",
  "search",
  "download",
  "user",
  "play",
  "pause",
  "plus",
  "check",
  "share",
  "settings",
  "back",
  "close",
  "chevron-right",
  "chevron-down",
  "volume",
  "mute",
  "fullscreen",
  "rewind",
  "forward",
  "subtitle",
  "cast",
  "lock",
  "star",
  "flame",
  "info",
  "menu",
];

const meta = {
  title: "Site/Icon",
  component: Icon,
  args: { name: "play", size: 24 },
  argTypes: {
    name: { control: "select", options: NAMES },
    size: { control: { type: "range", min: 10, max: 64, step: 1 } },
  },
  decorators: [
    (Story) => (
      <div className="text-cream">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Icon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllIcons: Story = {
  render: () => (
    <div className="grid grid-cols-4 gap-3 text-cream tablet:grid-cols-6">
      {NAMES.map((name) => (
        <div
          key={name}
          className="flex flex-col items-center gap-2 rounded-xl bg-espresso-2 p-3"
        >
          <Icon name={name} size={24} />
          <span className="font-mono text-[10px] text-cream/60">{name}</span>
        </div>
      ))}
    </div>
  ),
};

// The three call-site shapes the refactor left behind: gold pill (text on the
// parent), burgundy badge (text on the parent), and the unmute pill where the
// label stays cream and only the glyph is gold (class on the icon). Asserted
// on the COMPUTED fill / stroke, so a regression in how the SVG takes its
// colour fails here rather than in a screenshot.
export const InheritsCurrentColor: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-6">
      <span
        data-testid="on-gold"
        className="inline-flex size-12 items-center justify-center rounded-full bg-gold-cta text-gold-deep shadow-cta"
      >
        <Icon name="play" size={24} />
      </span>
      <span
        data-testid="on-burgundy"
        className="inline-flex size-12 items-center justify-center rounded-full bg-burgundy/80 text-cream"
      >
        <Icon name="play" size={24} />
      </span>
      <span
        data-testid="own-class"
        className="inline-flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-xs font-bold text-cream"
      >
        <Icon name="mute" size={14} className="text-gold" />
        Tap for sound
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const svg = (id: string) =>
      canvasElement.querySelector<SVGElement>(`[data-testid="${id}"] svg`)!;
    // "play" is a filled glyph → fill; "mute" is a stroke glyph → stroke.
    await expect(getComputedStyle(svg("on-gold")).fill).toBe("rgb(36, 18, 5)"); // gold-deep
    await expect(getComputedStyle(svg("on-burgundy")).fill).toBe(
      "rgb(246, 239, 228)", // cream
    );
    await expect(getComputedStyle(svg("own-class")).stroke).toBe(
      "rgb(230, 179, 102)", // gold
    );
  },
};
