import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { en } from "@/lib/i18n/dictionaries";
import { AboutContent } from "./about-content";

// The whole /about body as production renders it (route wrapper only adds
// dict resolution). Free mode is the live default; the paid variant proves the
// free-only claims (hero sentence, principle 03) disappear. English only since
// #445 — the Spanish story left with the site's Spanish.
const meta = {
  title: "About/AboutContent",
  component: AboutContent,
  parameters: { layout: "fullscreen" },
  args: {
    t: en,
    paymentsOn: false,
  },
} satisfies Meta<typeof AboutContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FreeMode: Story = {};

export const PaidMode: Story = {
  args: { paymentsOn: true },
};
