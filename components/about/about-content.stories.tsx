import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { en, es } from "@/lib/i18n/dictionaries";
import { teamForLocale } from "@/lib/about-team";
import { AboutContent } from "./about-content";

// The whole /about body as production renders it (route wrapper only adds
// dict/locale resolution). Free mode is the live default; the paid variant
// proves the free-only claims (hero sentence, principle 03) disappear.
const meta = {
  title: "About/AboutContent",
  component: AboutContent,
  parameters: { layout: "fullscreen" },
  args: {
    t: en,
    locale: "en",
    paymentsOn: false,
    team: teamForLocale("en"),
  },
} satisfies Meta<typeof AboutContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FreeMode: Story = {};

export const Spanish: Story = {
  args: { t: es, locale: "es", team: teamForLocale("es") },
};

export const PaidMode: Story = {
  args: { paymentsOn: true },
};
