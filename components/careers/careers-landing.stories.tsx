import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { VACANCIES, VACANCY_LIST } from "@/lib/careers";
import { en } from "@/lib/i18n/careers-dictionaries";
import type { JobApplicationResult } from "@/lib/job-application";
import { CareersFaq } from "./careers-faq";
import { CareersLanding } from "./careers-landing";

// The /careers page (#376) as production renders it: the client landing with
// the server-rendered FAQ in its slot. The design was picked on the
// five-variant "Matio Careers" canvas (variant A, "WE ARE / HIRING."), so
// these are STATE stories, not a variant board — no goldens.
//
// Viewports: @storybook/addon-vitest applies a story's `globals.viewport`
// (the preview's mobile 390×844 / desktop 1280×800 options) in
// `pnpm test:stories`; everything else runs at its default 1200×900, i.e.
// the tablet layout.

const ok = fn(async (): Promise<JobApplicationResult> => ({ ok: true }));

const meta = {
  title: "Careers/Landing",
  component: CareersLanding,
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
    vacancies: VACANCY_LIST,
    preselectedPosition: null,
    submitJobApplication: ok,
  },
  render: (args) => <CareersLanding {...args} faq={<CareersFaq t={en} />} />,
} satisfies Meta<typeof CareersLanding>;

export default meta;
type Story = StoryObj<typeof meta>;

const TYPED = {
  fullName: "Ana Rivera",
  email: "ana@example.com",
  location: "Madrid, Spain",
  portfolio: "https://vimeo.com/ana",
  message: "I make dark short films with generative tools.",
};

async function fillValid(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("radio", { name: "AI Creator" }));
  await userEvent.type(canvas.getByRole("textbox", { name: en.form.fullName.label }), TYPED.fullName);
  await userEvent.type(canvas.getByRole("textbox", { name: en.form.email.label }), TYPED.email);
  await userEvent.type(canvas.getByRole("textbox", { name: en.form.location.label }), TYPED.location);
  await userEvent.type(canvas.getByRole("textbox", { name: /^Portfolio or reel/ }), TYPED.portfolio);
  await userEvent.type(canvas.getByRole("textbox", { name: en.form.about.label }), TYPED.message);
  await userEvent.click(canvas.getByRole("checkbox", { name: en.form.age }));
}

// The arrival: hero, the two roles, How we work, the steps, the form, the
// FAQ — nothing picked yet.
export const Arrival: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent("We arehiring.");
    for (const v of VACANCY_LIST) {
      await expect(canvas.getByRole("article", { name: v.title })).toBeVisible();
    }
    await expect(canvas.getByRole("radio", { name: "AI Creator" })).not.toBeChecked();
    await expect(canvas.getByRole("heading", { name: en.faq.title })).toBeVisible();
  },
};

export const ArrivalMobile: Story = {
  name: "Mobile · arrival",
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1 })).toBeVisible();
    // The phone bar shows while the form is still below.
    await waitFor(() =>
      expect(canvas.getByRole("button", { name: new RegExp(`^${en.bar.apply}`) })).toBeVisible(),
    );
  },
};

export const ArrivalDesktop: Story = {
  name: "Desktop · arrival",
  globals: { viewport: { value: "desktop", isRotated: false } },
};

// `/careers?role=sales-distribution` — the form opens with Sales picked, its
// portfolio optional and its own About-you hint.
export const VacancyPreselected: Story = {
  args: { preselectedPosition: "sales-distribution" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "Sales & Distribution" })).toBeChecked();
    await expect(
      canvas.getByRole("textbox", { name: /^Website or other work/ }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(VACANCIES["sales-distribution"].aboutHint)).toBeVisible();
  },
};

// A card's Apply picks its role in the form.
export const ApplyFromCard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvas.getByRole("article", { name: "AI Creator" });
    await userEvent.click(within(card).getByRole("link", { name: en.roles.applyAria("AI Creator") }));
    await expect(canvas.getByRole("radio", { name: "AI Creator" })).toBeChecked();
  },
};

export const FormWithErrors: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("radio", { name: "AI Creator" }));
    await userEvent.type(
      canvas.getByRole("textbox", { name: /^LinkedIn/ }),
      "javascript:alert(1)",
    );
    await userEvent.click(canvas.getByRole("button", { name: en.form.submit }));

    await expect(canvas.getByRole("alert")).toHaveTextContent(en.errors.summary);
    for (const copy of [
      en.errors.nameRequired,
      en.errors.email,
      en.errors.locationRequired,
      en.errors.link,
      en.errors.portfolioRequired,
      en.errors.messageRequired,
      en.errors.age,
    ]) {
      await expect(canvas.getByText(copy)).toBeVisible();
    }
    await expect(canvas.getByRole("textbox", { name: en.form.fullName.label })).toHaveFocus();
    await expect(args.submitJobApplication).not.toHaveBeenCalled();
  },
};

export const RateLimited: Story = {
  args: {
    submitJobApplication: fn(
      async (): Promise<JobApplicationResult> => ({ ok: false, reason: "rate_limited" }),
    ),
  },
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.form.submit }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(en.errors.rateLimited);
    await expect(canvas.getByRole("textbox", { name: en.form.email.label })).toHaveValue(
      TYPED.email,
    );
  },
};

export const Success: Story = {
  play: async ({ canvasElement }) => {
    await fillValid(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: en.form.submit }));
    const card = await canvas.findByRole("status");
    await expect(card).toHaveTextContent(en.success.title("Ana"));
    await expect(card).toHaveTextContent(TYPED.email);
    await expect(within(card).getByRole("link", { name: en.success.watch })).toHaveAttribute(
      "href",
      "/",
    );
  },
};

export const SuccessMobile: Story = {
  name: "Mobile · success",
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: Success.play,
};
