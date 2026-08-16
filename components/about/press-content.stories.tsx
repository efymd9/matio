import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { en, es } from "@/lib/i18n/dictionaries";
import { PressContent } from "./press-content";

// The whole /press body: press-room hero, press-kit band with the ZIP
// download and asset cards, shared press-contact band. The paid variant
// drops the boilerplate's free-to-watch sentence.
const meta = {
  title: "About/PressContent",
  component: PressContent,
  parameters: { layout: "fullscreen" },
  args: {
    t: en,
    locale: "en",
    paymentsOn: false,
  },
} satisfies Meta<typeof PressContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FreeMode: Story = {};

export const Spanish: Story = {
  args: { t: es, locale: "es" },
};

export const PaidMode: Story = {
  args: { paymentsOn: true },
};
