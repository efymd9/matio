import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { IdeaSubmissionResult } from "@/lib/idea-submission";
import { en, ideasDictFor } from "@/lib/i18n/ideas-dictionaries";
import { IdeasLanding, type IdeasShow } from "./ideas-landing";
import { IdeasFaq, IdeasHowItWorks } from "./ideas-sections";

// The /ideas landing (#297) as production renders it: the client form with
// the server-rendered How-it-works + FAQ as its children. The design was
// picked on the five-variant canvas (variant A, its kicker over the H1
// removed), so these are STATE stories, not a variant board — no goldens.
//
// Viewports: @storybook/addon-vitest applies a story's `globals.viewport`
// (the preview's mobile 390×844 / desktop 1280×800 options) in
// `pnpm test:stories`; everything else runs at its default 1200×900, i.e.
// the 834–1279 one-column layout.

// Catalog order; three shows have committed artwork in public/shows, the
// rest render the tone-gradient placeholder poster.
const SHOWS: IdeasShow[] = [
  { slug: "the-scarlet-oath", title: "The Scarlet Oath", posterImageUrl: null },
  {
    slug: "quedate-conmigo",
    title: "Quédate Conmigo",
    posterImageUrl: "/shows/quedate-conmigo-poster.jpg",
  },
  { slug: "fallen", title: "Fallen", posterImageUrl: null },
  { slug: "second-hand", title: "Second Hand", posterImageUrl: null },
  { slug: "protocol-1500", title: "Protocol 1500", posterImageUrl: null },
  { slug: "morelli", title: "Morelli", posterImageUrl: null },
  {
    slug: "cartero-mundo",
    title: "El Cartero del Mundo",
    posterImageUrl: "/shows/cartero-mundo-poster.png",
  },
  {
    slug: "juego-de-seduccion",
    title: "Juego de Seducción",
    posterImageUrl: "/shows/juego-de-seduccion-poster.png",
  },
];

const ok = (onList: boolean) =>
  fn(async (): Promise<IdeaSubmissionResult> => ({ ok: true, onList }));

const meta = {
  title: "Ideas/Landing",
  component: IdeasLanding,
  parameters: { layout: "fullscreen" },
  // A full-bleed page: cancel the Lab canvas's 1.5rem padding so that 390
  // means 390 and the hero meets the edges, as in production.
  decorators: [
    (Story) => (
      <div className="-m-6">
        <Story />
      </div>
    ),
  ],
  args: {
    locale: "en",
    shows: SHOWS,
    preselectedSlug: null,
    heroImageUrl: "/shows/juego-de-seduccion-hero.png",
    submitIdea: ok(false),
  },
  render: (args) => {
    const t = ideasDictFor(args.locale);
    return (
      <IdeasLanding {...args}>
        <IdeasHowItWorks t={t} />
        <IdeasFaq t={t} locale={args.locale} />
      </IdeasLanding>
    );
  },
} satisfies Meta<typeof IdeasLanding>;

export default meta;
type Story = StoryObj<typeof meta>;

const TYPED = {
  logline: "What if a lighthouse keeper hid a whole city from the sea?",
  story: "The keeper lies to the navy. The sea remembers.",
  name: "Ana Rivera",
  email: "ana@example.com",
};

// Fills every required field with a valid value (no clicks on the bar).
async function fillValid(canvasElement: HTMLElement, series = "morelli") {
  const canvas = within(canvasElement);
  await userEvent.type(
    canvas.getByRole("textbox", { name: en.chapterLabels[1] }),
    TYPED.logline,
  );
  await userEvent.selectOptions(
    canvas.getByRole("combobox", { name: en.series.label }),
    series,
  );
  await userEvent.type(canvas.getByRole("textbox", { name: en.story.label }), TYPED.story);
  await userEvent.type(canvas.getByRole("textbox", { name: en.name.label }), TYPED.name);
  await userEvent.type(canvas.getByRole("textbox", { name: en.email.label }), TYPED.email);
  await userEvent.click(canvas.getByRole("checkbox", { name: en.ticks.age }));
  await userEvent.click(
    canvas.getByRole("checkbox", {
      name: (n) => n.startsWith(en.ticks.terms.before.trim()),
    }),
  );
}

async function expectDraftKept(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("textbox", { name: en.chapterLabels[1] })).toHaveValue(
    TYPED.logline,
  );
  await expect(canvas.getByRole("textbox", { name: en.story.label })).toHaveValue(TYPED.story);
  await expect(canvas.getByRole("textbox", { name: en.email.label })).toHaveValue(TYPED.email);
}

export const EmptyEN: Story = {};

// Spanish runs 20–30% longer — the H1, the CTA and the bar label have to
// hold at 390.
export const EmptyES: Story = {
  args: { locale: "es" },
  globals: { viewport: { value: "mobile", isRotated: false } },
};

export const PreselectedShow: Story = {
  args: {
    preselectedSlug: "quedate-conmigo",
    heroImageUrl: "/shows/quedate-conmigo-hero.jpg",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: en.series.label })).toHaveValue(
      "quedate-conmigo",
    );
    await expect(canvas.getByRole("textbox", { name: en.story.label })).toHaveAttribute(
      "placeholder",
      en.story.placeholderShow("Quédate Conmigo"),
    );
  },
};

export const ErrorsAfterSubmit: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.submit }));

    await expect(canvas.getByRole("alert")).toHaveTextContent(en.errors.summary);
    for (const copy of [
      en.errors.loglineRequired,
      en.errors.series,
      en.errors.storyRequired,
      en.errors.nameRequired,
      en.errors.email,
      en.errors.age,
      en.errors.terms,
    ]) {
      await expect(canvas.getByText(copy)).toBeVisible();
    }
    await expect(canvas.getByRole("textbox", { name: en.chapterLabels[1] })).toHaveFocus();
    await expect(args.submitIdea).not.toHaveBeenCalled();
  },
};

export const OverCaps: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const logline = canvas.getByRole("textbox", { name: en.chapterLabels[1] });
    await userEvent.click(logline);
    await userEvent.paste("x".repeat(301));
    await expect(canvas.getByText("301 / 300 · 1 over")).toBeVisible();
    await expect(logline).toHaveAttribute("aria-invalid", "true");

    const story = canvas.getByRole("textbox", { name: en.story.label });
    await userEvent.click(story);
    await userEvent.paste("y".repeat(10_240));
    await expect(canvas.getByText("10,240 / 10,000 · 240 over")).toBeVisible();
    // Nothing is cut.
    await expect((story as HTMLTextAreaElement).value).toHaveLength(10_240);
  },
};

export const RateLimited: Story = {
  args: {
    submitIdea: fn(
      async (): Promise<IdeaSubmissionResult> => ({ ok: false, reason: "rate_limited" }),
    ),
  },
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.submit }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(en.errors.rateLimited);
    await expectDraftKept(canvasElement);
  },
};

export const ServerError: Story = {
  args: {
    submitIdea: fn(
      async (): Promise<IdeaSubmissionResult> => ({ ok: false, reason: "server_error" }),
    ),
  },
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.submit }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(en.errors.generic);
    await expectDraftKept(canvasElement);
  },
};

// The action's promise REJECTS (network drop in an in-app browser, "Failed
// to find Server Action" after a deploy): the generic pill, the page stays.
export const RejectedAction: Story = {
  args: {
    submitIdea: fn(async (): Promise<IdeaSubmissionResult> => {
      throw new TypeError("Failed to fetch");
    }),
  },
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.submit }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(en.errors.generic);
    await expectDraftKept(canvasElement);
  },
};

export const SuccessOnList: Story = {
  args: { submitIdea: ok(true) },
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("checkbox", { name: en.ticks.optIn }));
    await userEvent.click(canvas.getByRole("button", { name: en.submit }));
    const card = await canvas.findByRole("status");
    await expect(card).toHaveTextContent(en.success.title);
    await expect(card).toHaveTextContent(TYPED.name);
    await expect(card).toHaveTextContent(en.success.onList);
  },
};

export const SuccessNotOnList: Story = {
  args: { submitIdea: ok(false) },
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement, "new");
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.submit }));
    const card = await canvas.findByRole("status");
    await expect(card).toHaveTextContent(TYPED.email);
    await expect(card).not.toHaveTextContent(en.success.onList);
  },
};

export const TermsSheet: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Tick 2's link comes first in the DOM; the FAQ's opens the same sheet.
    const [link] = canvas.getAllByRole("button", { name: en.ticks.terms.link });
    await userEvent.click(link);

    const dialog = await within(document.body).findByRole("dialog", {
      name: en.terms.title,
    });
    await expect(dialog).toHaveTextContent(en.terms.version);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        canvas.getByRole("checkbox", {
          name: (n) => n.startsWith(en.ticks.terms.before.trim()),
        }),
      ).toHaveFocus(),
    );
  },
};

export const MobileBarArmed: Story = {
  name: "Mobile · bar armed",
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: en.barNext })).toBeNull();

    await userEvent.type(canvas.getByRole("textbox", { name: en.chapterLabels[1] }), "W");
    // The field still has focus — the keyboard would be up.
    await expect(canvas.queryByRole("button", { name: en.barNext })).toBeNull();

    await userEvent.tab(); // focus leaves for the hero CTA
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: en.barNext })).toBeVisible(),
    );

    await userEvent.click(canvas.getByRole("textbox", { name: en.name.label }));
    await waitFor(() =>
      expect(canvas.queryByRole("button", { name: en.barNext })).toBeNull(),
    );
  },
};

export const DesktopRail: Story = {
  name: "Desktop · rail",
  globals: { viewport: { value: "desktop", isRotated: false } },
  args: {
    preselectedSlug: "quedate-conmigo",
    heroImageUrl: "/shows/quedate-conmigo-hero.jpg",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvas.getByRole("complementary", { name: en.rail.title });
    await expect(rail).toBeVisible();
    await expect(rail).toHaveTextContent("Quédate Conmigo");
    await expect(within(rail).queryAllByRole("img", { name: en.rail.done })).toHaveLength(0);

    await userEvent.type(
      canvas.getByRole("textbox", { name: en.chapterLabels[1] }),
      TYPED.logline,
    );
    await expect(rail).toHaveTextContent(TYPED.logline);
    // Chapter 1 is complete; 2 still needs the story, 3 everything.
    await expect(within(rail).getAllByRole("img", { name: en.rail.done })).toHaveLength(1);
    // No bar on desktop. Focus leaves the field first (as in «Mobile · bar
    // armed», where the same steps show it): the bar's state is now "shown",
    // so only the `tablet:hidden` breakpoint keeps it off this screen.
    await userEvent.tab();
    const bar = canvas.getByRole("button", { name: en.barNext, hidden: true });
    await waitFor(() =>
      expect(bar.closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "false"),
    );
    await expect(bar).not.toBeVisible();
    await expect(canvas.queryByRole("button", { name: en.barNext })).toBeNull();
  },
};
