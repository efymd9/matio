import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TONE_KEYS } from "@/lib/design";
import { golden } from "@/lab/golden";

import { Poster } from "./poster";

// The catalog's workhorse: every rail, the show page and the continue-watching
// row render this. Artwork is optional by design — a show with no poster still
// has to look deliberate, which is what the tone gradients are for.
const meta = {
  title: "Site/Poster",
  component: Poster,
  args: {
    tone: "a",
    title: "Thunder Lady",
    kind: "Series",
    rounded: "card",
  },
  argTypes: {
    tone: { control: "select", options: TONE_KEYS },
    rounded: {
      control: "select",
      options: ["md", "lg", "xl", "2xl", "card", "card2xl"],
    },
    badge: { control: "text" },
    showTitleOnPlaceholder: { control: "boolean" },
  },
  decorators: [
    (Story) => (
      <div className="w-[220px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Poster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Placeholder: Story = {};

export const WithBadge: Story = {
  args: { badge: "New episode" },
};

// A long title is not an edge case — Spanish titles run ~20% longer than the
// English ones, and this is where clipping shows up first.
export const LongTitle: Story = {
  args: { title: "La señora del trueno y la tormenta eterna" },
};

// The whole tone palette at once: the placeholders must read as one family,
// not six unrelated cards.
export const AllTones: Story = {
  play: async ({ canvasElement }) => golden(canvasElement, "poster-tones"),
  decorators: [
    (Story) => (
      <div className="grid grid-cols-3 gap-4" style={{ width: 720 }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <>
      {TONE_KEYS.map((tone) => (
        <Poster key={tone} {...args} tone={tone} title={`Tone ${tone}`} />
      ))}
    </>
  ),
};
