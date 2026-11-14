import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { licensing, studio } from "@/lib/i18n/b2b-dictionaries";
import type { LicensingCard } from "@/lib/show-facts";
import { ScreenerRequestForm, StudioBriefForm } from "./b2b-forms";
import { LicensingContent } from "./licensing-content";
import { StudioContent } from "./studio-content";

// The /studio and /licensing bodies (#498) as production renders them — the
// route wrappers only resolve the catalogue and hand the form in. The
// actions are spies that answer `{ ok: true }`.

const okAction = fn(async () => ({ ok: true as const }));

const SCARLET = {
  slug: "the-scarlet-oath",
  title: "THE SCARLET OATH",
  genres: ["dark Romance", "gothic", "drama"],
  episodes: "9 episodes · 9–24 min",
  posterImageUrl: null,
};

const meta = {
  title: "B2B/Pages",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Studio: Story = {
  render: () => (
    <StudioContent
      t={studio}
      showcase={SCARLET}
      beforeAfter={null}
      form={<StudioBriefForm submit={okAction} />}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole("heading", { level: 1 })).toHaveTextContent("Film, series & VFX production");
    // An empty send is refused locally, before the action.
    await userEvent.click(c.getByRole("button", { name: "Send brief" }));
    await expect(c.getByRole("alert")).toHaveTextContent("Please fix 4 fields above.");
    await expect(okAction).not.toHaveBeenCalled();
  },
};

// The slot for the VFX pair, filled with two /about stills as stand-ins —
// production keeps it off until a public pair on Matio's own footage exists.
export const StudioWithBeforeAfter: Story = {
  render: () => (
    <StudioContent
      t={studio}
      showcase={SCARLET}
      beforeAfter={{
        beforeSrc: "/about/still-mission.jpg",
        afterSrc: "/about/still-vision.jpg",
        beforeAlt: "The plate as shot",
        afterAlt: "The same shot with the environment replaced",
        caption: "Environment replacement on a Matio original — the performance untouched.",
      }}
      form={<StudioBriefForm submit={okAction} />}
    />
  ),
};

const CARDS: LicensingCard[] = [
  {
    slug: "the-scarlet-oath",
    title: "THE SCARLET OATH",
    logline: "A gothic dark romance: a vow sealed in blood, and the price of keeping it.",
    genres: ["dark Romance", "gothic", "drama"],
    episodes: "9 episodes · 9–24 min",
    languages: ["English (original)"],
    format: "Scripted series · 16:9",
    trailerUrl: "https://www.youtube.com/",
    posterImageUrl: null,
  },
  {
    slug: "the-prophecy",
    title: "The Prophecy",
    logline: "An epic fantasy in seven short chapters.",
    genres: ["Epic Fantasy"],
    episodes: "7 episodes · 2 min",
    languages: ["English (original)"],
    format: "Short series · 16:9",
    trailerUrl: null,
    posterImageUrl: null,
  },
];

export const LicensingWithTitles: Story = {
  render: () => (
    <LicensingContent
      t={licensing}
      cards={CARDS}
      form={
        <ScreenerRequestForm
         
          titles={CARDS.map((c) => ({ slug: c.slug, title: c.title }))}
          preselected="the-scarlet-oath"
          submit={okAction}
        />
      }
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByLabelText("Title")).toHaveValue("the-scarlet-oath");
    await expect(c.getAllByRole("link", { name: "Request a screener" })).toHaveLength(3);
  },
};

// Until the team confirms the first titles (lib/licensing.ts is empty).
export const LicensingEmpty: Story = {
  render: () => (
    <LicensingContent
      t={licensing}
      cards={[]}
      form={<ScreenerRequestForm titles={[]} preselected={null} submit={okAction} />}
    />
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByText(/confirming the first titles/)).toBeVisible();
    await expect(c.queryByLabelText("Title")).toBeNull();
  },
};
