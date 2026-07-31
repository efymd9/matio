import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { golden } from "@/lab/golden";

import { SocialIcon } from "./social-icon";

// Brand glyphs for the footer row. Filled paths, not strokes — a TikTok note or
// a Facebook circle does not survive being reduced to a 1.7px outline.
const meta = {
  title: "Site/SocialIcon",
  component: SocialIcon,
  args: { platform: "instagram", size: 18 },
  argTypes: {
    platform: {
      control: "select",
      options: ["tiktok", "instagram", "youtube", "facebook"],
    },
    size: { control: { type: "range", min: 12, max: 64, step: 2 } },
  },
} satisfies Meta<typeof SocialIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {};

// The row as the footer actually renders it: `fill="currentColor"`, so the tint
// comes from the parent. If one glyph looks heavier than the others at 18px,
// that is a real optical-weight bug, not a rendering artefact.
export const FooterRow: Story = {
  play: async ({ canvasElement }) => golden(canvasElement, "social-footer-row"),
  render: (args) => (
    <div className="flex items-center gap-5 text-cream/70">
      {(["tiktok", "instagram", "youtube", "facebook"] as const).map(
        (platform) => (
          <SocialIcon key={platform} {...args} platform={platform} />
        ),
      )}
    </div>
  ),
};

export const AtDisplaySize: Story = {
  args: { size: 48 },
  render: (args) => (
    <div className="flex items-center gap-6 text-gold">
      {(["tiktok", "instagram", "youtube", "facebook"] as const).map(
        (platform) => (
          <SocialIcon key={platform} {...args} platform={platform} />
        ),
      )}
    </div>
  ),
};

