import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { useEffect, useState } from "react";

import {
  ForkChoiceOverlay,
  type ForkChoiceOption,
  type ForkChoiceProps,
} from "@/components/watch/fork-choice-overlay";

import {
  ForkChoiceCards,
  ForkChoiceHalves,
  ForkChoiceSheet,
  ForkChoiceStrip,
  PlayerFrame,
} from "./fork-choice-variants";
import { golden } from "./golden";

// Lab-first board for the fork prompt (#144): five genuinely different
// answers to "the parent is ending — pick a branch", side by side over the
// same stand-in frame at the same moment of the clock (6.4s of a 10s
// window left, nothing picked). The owner looks at these live on a device;
// variant A ships in the product until he decides otherwise (the swap is
// one decision — same props, copy the markup into the product component).
//
// Each variant's story is a golden (`fork-choice-<key>`): a change to any of
// them is a design change and shows up as a pixel diff to look at, not a
// test to re-run. The board itself is NOT a golden — five frames stacked
// run past the test browser's viewport, and the screenshot paints black
// below the fold (seen on the first run); one frame per PNG fits.
const OPTIONS: ForkChoiceOption[] = [
  { episodeId: "b-901", label: "Kiss him", isDefault: false },
  { episodeId: "b-902", label: "Walk away", isDefault: true },
];

const THREE: ForkChoiceOption[] = [
  ...OPTIONS,
  { episodeId: "b-903", label: "Call her bluff", isDefault: false },
];

const BASE: Omit<ForkChoiceProps, "onChoose" | "inline"> = {
  prompt: "Kiss him or walk away?",
  options: OPTIONS,
  chosenId: null,
  remainingSeconds: 6.4,
  windowSeconds: 10,
};

type VariantKey = "A" | "B" | "C" | "D" | "E";

const VARIANTS: {
  key: VariantKey;
  name: string;
  summary: string;
  render: (props: Omit<ForkChoiceProps, "inline">) => React.ReactNode;
}[] = [
  {
    key: "A",
    name: "Bar (ships)",
    summary:
      "Bottom band, display-face prompt, one pill per option; the default's gold fill grows as the clock runs out.",
    render: (p) => <ForkChoiceOverlay {...p} inline />,
  },
  {
    key: "B",
    name: "Cards",
    summary:
      "Centred sheet over a dimmed frame, thumbnail cards; the countdown shrinks under the default card.",
    render: (p) => <ForkChoiceCards {...p} />,
  },
  {
    key: "C",
    name: "Sheet",
    summary:
      "The up-next card's twin in the corner; radio rows, a countdown ring on the default.",
    render: (p) => <ForkChoiceSheet {...p} />,
  },
  {
    key: "D",
    name: "Strip",
    summary:
      "A subtitle: prompt pill, underlined options, a hairline countdown; digits only in the last 3s.",
    render: (p) => <ForkChoiceStrip {...p} />,
  },
  {
    key: "E",
    name: "Halves",
    summary:
      "The whole frame is the control: one full-height zone per option, the default lit gold, countdown along the top edge.",
    render: (p) => <ForkChoiceHalves {...p} />,
  },
];

// The one arg every interactive story shares: the pick callback, a spy so
// the play functions can assert which id a tap reports.
type BoardArgs = { onChoose: (episodeId: string) => void };

const meta = {
  title: "Lab/Fork choice",
  parameters: { layout: "fullscreen" },
  args: { onChoose: fn() },
} satisfies Meta<BoardArgs>;

export default meta;
type Story = StoryObj<BoardArgs>;

export const Board: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {VARIANTS.map((v) => (
        <section key={v.key} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl uppercase text-gold">
              {v.key}
            </span>
            <span className="text-sm font-bold text-cream">{v.name}</span>
            <span className="text-xs text-cream/60">{v.summary}</span>
          </div>
          <PlayerFrame>{v.render({ ...BASE, onChoose: () => {} })}</PlayerFrame>
        </section>
      ))}
    </div>
  ),
};

// Each variant alone: the golden first (three options, 6.4s of 10 left,
// nothing picked), then the interaction — a tap on the non-default option
// must report its id, and the default must be marked pressed=false until
// then. The play function is the same for all five — identical contract.
function variantStory(key: VariantKey): Story {
  const v = VARIANTS.find((x) => x.key === key)!;
  return {
    name: `${v.key} · ${v.name}`,
    render: (args) => (
      <div className="p-6">
        <PlayerFrame>
          {v.render({ ...BASE, options: THREE, onChoose: args.onChoose })}
        </PlayerFrame>
      </div>
    ),
    play: async ({ args, canvasElement }) => {
      await golden(canvasElement, `fork-choice-${key.toLowerCase()}`);
      const canvas = within(canvasElement);
      const kiss = canvas.getByRole("button", { name: /kiss him/i });
      const walkAway = canvas.getByRole("button", { name: /walk away/i });
      await expect(walkAway).toHaveAttribute("aria-pressed", "false");
      await userEvent.click(kiss);
      await expect(args.onChoose).toHaveBeenCalledWith("b-901");
    },
  };
}

export const A_Bar = variantStory("A");
export const B_Cards = variantStory("B");
export const C_Sheet = variantStory("C");
export const D_Strip = variantStory("D");
export const E_Halves = variantStory("E");

// The clock, simulated: in the product the countdown is the video's own
// remaining time and the default plays at `ended` (player.tsx). Here a
// ticking wrapper stands in for the <video> so the owner can watch a full
// window run down and see the untouched default get taken.
function Ticking({
  windowSeconds,
  render,
}: {
  windowSeconds: number;
  render: (props: Omit<ForkChoiceProps, "inline">) => React.ReactNode;
}) {
  const [remaining, setRemaining] = useState(windowSeconds);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const done = remaining <= 0;
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 0.25));
    }, 250);
    return () => clearInterval(id);
  }, [done]);
  // What the player does at `ended`: the pick, else the default — derived,
  // not stored, so the clock and the outcome can never disagree.
  const outcome = done
    ? (OPTIONS.find((o) => o.episodeId === chosenId) ??
      OPTIONS.find((o) => o.isDefault)!).label
    : null;
  return (
    <div className="flex flex-col gap-3 p-6">
      <PlayerFrame>
        {outcome ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p
              data-testid="outcome"
              className="rounded-full bg-black/60 px-5 py-2 text-sm font-bold text-cream backdrop-blur-xl"
            >
              → {outcome}
            </p>
          </div>
        ) : (
          render({
            ...BASE,
            remainingSeconds: remaining,
            windowSeconds,
            chosenId,
            onChoose: setChosenId,
          })
        )}
      </PlayerFrame>
    </div>
  );
}

export const TimesOutToDefault: Story = {
  render: () => (
    <Ticking
      windowSeconds={3}
      render={(p) => <ForkChoiceOverlay {...p} inline />}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: /walk away/i })).toBeVisible();
    await waitFor(
      () => expect(canvas.getByTestId("outcome")).toHaveTextContent("Walk away"),
      { timeout: 6_000 },
    );
  },
};

export const PickBeatsTheClock: Story = {
  render: () => (
    <Ticking
      windowSeconds={3}
      render={(p) => <ForkChoiceOverlay {...p} inline />}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /kiss him/i }));
    await waitFor(
      () => expect(canvas.getByTestId("outcome")).toHaveTextContent("Kiss him"),
      { timeout: 6_000 },
    );
  },
};
