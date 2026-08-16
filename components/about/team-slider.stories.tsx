import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { en, es } from "@/lib/i18n/dictionaries";
import { teamForLocale, TEAM_SIZE } from "@/lib/about-team";
import { TeamSlider } from "./team-slider";

// Accordion team slider from the /about redesign. The play function drives
// the real interactions — rotate the window, activate a card — so the Lab
// run is also the behavioural test for the slider's state machine.
const meta = {
  title: "About/TeamSlider",
  component: TeamSlider,
  parameters: { layout: "padded" },
  args: {
    members: teamForLocale("en"),
    heading1: en.about.teamHeading1,
    heading2: en.about.teamHeading2,
    sub: en.about.teamSub(TEAM_SIZE),
    prevLabel: en.about.teamPrev,
    nextLabel: en.about.teamNext,
  },
} satisfies Meta<typeof TeamSlider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const counter = canvas.getByTestId("team-counter");
    await expect(counter).toHaveTextContent(`01–04 / ${TEAM_SIZE}`);

    // Rotate forward: the window slides by one and wraps the counter.
    await userEvent.click(canvas.getByRole("button", { name: en.about.teamNext }));
    await expect(counter).toHaveTextContent(`02–05 / ${TEAM_SIZE}`);

    // And back — including wrapping below zero.
    const prev = canvas.getByRole("button", { name: en.about.teamPrev });
    await userEvent.click(prev);
    await expect(counter).toHaveTextContent(`01–04 / ${TEAM_SIZE}`);
    await userEvent.click(prev);
    await expect(counter).toHaveTextContent(`${TEAM_SIZE}–03 / ${TEAM_SIZE}`);

    // Activating another card expands it (flex-grow 1.55). The computed style
    // is mid-transition right after the click (transition-[flex]), so assert
    // the inline style the component sets, not the animated computed value.
    const second = canvas.getByRole("button", { name: /Mark Osipov/ });
    await userEvent.click(second);
    await expect(second).toHaveAttribute(
      "style",
      expect.stringContaining("1.55") as unknown as string,
    );
  },
};

export const Spanish: Story = {
  args: {
    members: teamForLocale("es"),
    heading1: es.about.teamHeading1,
    heading2: es.about.teamHeading2,
    sub: es.about.teamSub(TEAM_SIZE),
    prevLabel: es.about.teamPrev,
    nextLabel: es.about.teamNext,
  },
};
