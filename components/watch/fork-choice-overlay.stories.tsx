import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { PlayerFrame } from "@/lab/fork-choice-variants";

import { ForkChoiceOverlay, type ForkChoiceOption } from "./fork-choice-overlay";

// The fork prompt as it ships (#144, Lab-first variant A — "the bar"). The
// other four variants are on the Lab board (Lab/Fork choice). Stories mount
// the overlay INLINE inside a stand-in player frame: in the product it
// portals to document.body and pins to the viewport bottom, which a canvas
// screenshot could not frame. Copy on the prompt and the options is row
// copy from the admin panel (already localized); only the kicker, the tags
// and the countdown come from the dictionary.
const TWO: ForkChoiceOption[] = [
  { episodeId: "b-901", label: "Kiss him", isDefault: false },
  { episodeId: "b-902", label: "Walk away", isDefault: true },
];

const THREE: ForkChoiceOption[] = [
  { episodeId: "b-901", label: "Kiss him", isDefault: false },
  { episodeId: "b-902", label: "Walk away", isDefault: true },
  { episodeId: "b-903", label: "Call her bluff", isDefault: false },
];

const meta = {
  title: "Watch/Fork choice overlay",
  component: ForkChoiceOverlay,
  args: {
    prompt: "Kiss him or walk away?",
    options: TWO,
    chosenId: null,
    remainingSeconds: 6.4,
    windowSeconds: 10,
    onChoose: fn(),
    inline: true,
  },
  argTypes: {
    remainingSeconds: {
      control: { type: "range", min: 0, max: 30, step: 0.5 },
    },
    windowSeconds: { control: { type: "range", min: 3, max: 30, step: 1 } },
    chosenId: {
      control: "select",
      options: [null, "b-901", "b-902", "b-903"],
    },
  },
  decorators: [
    (Story) => (
      <PlayerFrame>
        <Story />
      </PlayerFrame>
    ),
  ],
} satisfies Meta<typeof ForkChoiceOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

// Two options, nothing picked: the default is focused (Enter confirms it),
// wears the "Auto" tag and the growing fill; a tap on the other option
// reports its id — the player decides what to do with it at `ended`.
export const TwoOptions: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const walkAway = canvas.getByRole("button", { name: /walk away/i });
    const kiss = canvas.getByRole("button", { name: /kiss him/i });

    await expect(walkAway).toHaveFocus();
    // Wide frame → the pills sit in a row (container query on the overlay's
    // own width, not the viewport's).
    await expect(
      getComputedStyle(canvas.getByTestId("fork-options")).flexDirection,
    ).toBe("row");
    await expect(walkAway).toHaveTextContent(/auto/i);
    await expect(kiss).not.toHaveTextContent(/auto/i);
    await expect(canvas.getByText("Auto in 7s")).toBeVisible();
    // The fill sits only on the armed (default) pill and reflects the
    // elapsed share of the window: 10s window, 6.4s left → 36% gone.
    const fill = canvasElement.querySelector<HTMLElement>(
      '[data-testid="fork-fill"]',
    );
    await expect(fill).not.toBeNull();
    await expect(fill!.style.width).toBe("36%");

    await userEvent.click(kiss);
    await expect(args.onChoose).toHaveBeenCalledWith("b-901");
  },
};

export const ThreeOptions: Story = {
  args: { options: THREE, remainingSeconds: 12, windowSeconds: 15 },
};

// A pick made: the chosen pill goes solid gold with a "Chosen" tag, the
// default loses its "Auto" tag and its fill — the clock keeps running, but
// what plays at the end is now the pick.
export const Chosen: Story = {
  args: { chosenId: "b-901", remainingSeconds: 3.2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kiss = canvas.getByRole("button", { name: /kiss him/i });
    const walkAway = canvas.getByRole("button", { name: /walk away/i });
    await expect(kiss).toHaveAttribute("aria-pressed", "true");
    await expect(kiss).toHaveTextContent(/chosen/i);
    await expect(walkAway).toHaveAttribute("aria-pressed", "false");
    await expect(walkAway).not.toHaveTextContent(/auto/i);
    await expect(
      canvasElement.querySelector('[data-testid="fork-fill"]'),
    ).toBeNull();
  },
};

// The last second: the countdown rounds UP (0.6s left still reads "1s"),
// and the fill is nearly full.
export const LastSecond: Story = {
  args: { remainingSeconds: 0.6 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Auto in 1s")).toBeVisible();
    const fill = canvasElement.querySelector<HTMLElement>(
      '[data-testid="fork-fill"]',
    );
    await expect(fill!.style.width).toBe("94%");
  },
};

// Long labels truncate inside their pill instead of wrapping the bar.
export const LongLabels: Story = {
  args: {
    prompt: "Does she confront him about the letter tonight?",
    options: [
      {
        episodeId: "b-901",
        label: "Confront him in front of everyone at the dinner",
        isDefault: true,
      },
      {
        episodeId: "b-902",
        label: "Keep the letter to herself and wait for the morning",
        isDefault: false,
      },
    ],
  },
};

// Spanish row copy — the layout has to hold longer strings; the chrome
// strings follow the site locale (the Lab has no provider, so they stay
// English here).
export const SpanishCopy: Story = {
  args: {
    prompt: "¿Le besa o se marcha?",
    options: [
      { episodeId: "b-901", label: "Besarle", isDefault: false },
      { episodeId: "b-902", label: "Marcharse sin decir nada", isDefault: true },
    ],
  },
};

// Portrait phone: the pills stack — the overlay is a `@container`, so a
// 390px-wide frame gets the phone layout even on a desktop Lab.
export const Portrait: Story = {
  args: { options: THREE },
  decorators: [
    (Story) => (
      <PlayerFrame portrait width={390}>
        <Story />
      </PlayerFrame>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      getComputedStyle(canvas.getByTestId("fork-options")).flexDirection,
    ).toBe("column");
    await expect(canvas.getAllByRole("button")).toHaveLength(3);
  },
};
