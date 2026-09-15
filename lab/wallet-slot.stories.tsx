import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import {
  WallFrame,
  WalletSlotAbsent,
  WalletSlotFirst,
  WalletSlotSplit,
  WalletSlotStacked,
  WalletSlotTerse,
} from "./wallet-slot-variants";
import { golden } from "./golden";

// Lab-first board for the paywall's in-place Apple Pay / Google Pay slot
// (#210): five genuinely different answers to "the viewer hit the wall — how
// does a wallet button live next to the card CTA and the consent we now have
// to collect ourselves", over the same stand-in frame.
//
// The wallet button is a Stripe iframe drawing Apple's and Google's own
// artwork, so what is on the board is a fixed-height inert slot and what the
// goldens pin is the LAYOUT around it. Variant A ships until the owner
// decides otherwise; the swap is one decision, the props are identical.
//
// E is not a fifth arrangement — it is the state the other four degrade into
// when the device has no wallet, which is the majority state on desktop and
// inside the Meta webviews where most ad traffic lands. It earns a seat
// because "what does this wall look like when the button never appears" is
// the question a wallet-first design gets wrong.
type VariantKey = "A" | "B" | "C" | "D" | "E";

const VARIANTS: {
  key: VariantKey;
  name: string;
  summary: string;
  render: () => React.ReactNode;
}[] = [
  {
    key: "A",
    name: "Stacked (ships)",
    summary:
      "Card CTA stays primary; consent checkbox, then the wallet slot beneath it. Smallest change to a wall that already converts.",
    render: () => <WalletSlotStacked />,
  },
  {
    key: "B",
    name: "Wallet first",
    summary:
      "Wallet is the hero at full height; the card path demotes to a text link. The most literal reading of the ask.",
    render: () => <WalletSlotFirst />,
  },
  {
    key: "C",
    name: "Split",
    summary:
      "Wallet and card side by side over one shared consent line — neither method reads as the fallback.",
    render: () => <WalletSlotSplit />,
  },
  {
    key: "D",
    name: "Terse consent",
    summary:
      "Wallet on top, the consent (Terms + waiver) reduced to one line with an inline tick — still an explicit, unticked opt-in.",
    render: () => <WalletSlotTerse />,
  },
  {
    key: "E",
    name: "No wallet available",
    summary:
      "The degraded state: no wallet on the device, so the slot and its consent vanish and the wall is exactly today's.",
    render: () => <WalletSlotAbsent />,
  },
];

const meta = {
  title: "Lab/Wallet slot",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

// The board itself is NOT a golden — five frames stacked run past the test
// browser's viewport and the screenshot paints black below the fold (the
// lesson from the fork-choice board). One frame per PNG fits.
export const Board: Story = {
  render: () => (
    <div className="flex flex-col gap-8 p-6">
      {VARIANTS.map((v) => (
        <section key={v.key} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl text-gold uppercase">
              {v.key}
            </span>
            <span className="text-sm font-bold text-cream">{v.name}</span>
            <span className="text-xs text-cream/60">{v.summary}</span>
          </div>
          <WallFrame>{v.render()}</WallFrame>
        </section>
      ))}
    </div>
  ),
};

function variantStory(key: VariantKey): Story {
  const v = VARIANTS.find((x) => x.key === key)!;
  return {
    name: `${v.key} · ${v.name}`,
    render: () => <div className="p-6">
      <WallFrame>{v.render()}</WallFrame>
    </div>,
    play: async ({ canvasElement }) => {
      await golden(canvasElement, `wallet-slot-${key.toLowerCase()}`);
      const canvas = within(canvasElement);

      // Every variant that offers a wallet must ALSO offer a non-wallet path
      // and must ask for consent before it — those two are the contract, not
      // the arrangement. E is the exception by construction: no wallet, so no
      // consent line and no slot.
      const slot = canvas.queryByText(/Apple Pay/i);
      const consent = canvasElement.querySelector('input[type="checkbox"]');
      if (key === "E") {
        await expect(slot).toBeNull();
        await expect(consent).toBeNull();
      } else {
        await expect(slot).not.toBeNull();
        await expect(consent).not.toBeNull();
        // A pre-ticked consent box is invalid under EU law; it must start off
        // in every variant.
        await expect(consent).not.toBeChecked();
      }
      // The card path survives in all five — Apple's Acceptable Use
      // Guidelines want the wallet ALONGSIDE other methods, not replacing
      // them, and a device with no wallet must still be able to pay.
      await expect(
        canvas.getAllByText(/pay with card|subscribe/i).length,
      ).toBeGreaterThan(0);
    },
  };
}

export const A_Stacked = variantStory("A");
export const B_WalletFirst = variantStory("B");
export const C_Split = variantStory("C");
export const D_Terse = variantStory("D");
export const E_NoWallet = variantStory("E");
