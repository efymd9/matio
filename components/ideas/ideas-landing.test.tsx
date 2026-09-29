/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_CHANGED_EVENT, COOKIE_PREFS_EVENT } from "@/lib/cookie-consent";
import type { IdeaSubmissionResult } from "@/lib/idea-submission";
import { en } from "@/lib/i18n/ideas-dictionaries";

// The /ideas form's behaviour (#297), in jsdom: validation after the first
// send, the server's three failure answers, a REJECTED action (the one that
// would otherwise blow the page up through startTransition), the success card
// and its reset, the analytics payload — and that nothing the fan typed ever
// reaches the console or an event. The layout itself lives in the Lab stories.

const events = vi.hoisted(() => ({
  capturePostHog: vi.fn(),
  trackPixel: vi.fn(),
}));
vi.mock("@/lib/posthog-events", () => ({ capturePostHog: events.capturePostHog }));
vi.mock("@/lib/meta-pixel-events", () => ({ trackPixel: events.trackPixel }));

import { IdeasLanding, type IdeasShow } from "./ideas-landing";
import { IdeasFaq } from "./ideas-sections";

const SHOWS: IdeasShow[] = [
  { slug: "the-scarlet-oath", title: "The Scarlet Oath", posterImageUrl: null },
  { slug: "morelli", title: "Morelli", posterImageUrl: null },
];

// Recognisable values — if any of them shows up in a log line or an event,
// the assertion names it.
const TYPED = {
  logline: "What if a lighthouse keeper MARKER-LOGLINE-7Q hid a city?",
  story: "Scene one. MARKER-STORY-7Q. The keeper lies.",
  name: "Marker Penname 7Q",
  email: "Marker.7Q@Example.com",
};

// jsdom has neither IntersectionObserver nor scrollIntoView. The observer
// stub keeps its callback so a test can say "the submit button is on screen".
let observerCallbacks: IntersectionObserverCallback[] = [];
const scrollIntoView = vi.fn();

beforeEach(() => {
  observerCallbacks = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        observerCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = scrollIntoView;
  events.capturePostHog.mockReset();
  events.trackPixel.mockReset();
  scrollIntoView.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  document.querySelectorAll("[data-cookie-banner]").forEach((n) => n.remove());
});

function setup(
  submitIdea: (input: unknown) => Promise<IdeaSubmissionResult> = vi.fn(
    async () => ({ ok: true, onList: false }) as IdeaSubmissionResult,
  ),
  props: { preselectedSlug?: string | null; withFaq?: boolean } = {},
) {
  render(
    <IdeasLanding
      locale="en"
      shows={SHOWS}
      preselectedSlug={props.preselectedSlug ?? null}
      heroImageUrl={null}
      submitIdea={submitIdea}
    >
      {props.withFaq ? <IdeasFaq t={en} locale="en" /> : null}
    </IdeasLanding>,
  );
  const field = {
    logline: screen.getByRole("textbox", { name: en.chapterLabels[1] }) as HTMLTextAreaElement,
    series: screen.getByRole("combobox", { name: en.series.label }) as HTMLSelectElement,
    title: screen.getByRole("textbox", { name: en.workingTitle.label }) as HTMLInputElement,
    story: screen.getByRole("textbox", { name: en.story.label }) as HTMLTextAreaElement,
    name: screen.getByRole("textbox", { name: en.name.label }) as HTMLInputElement,
    email: screen.getByRole("textbox", { name: en.email.label }) as HTMLInputElement,
    age: screen.getByRole("checkbox", { name: en.ticks.age }) as HTMLInputElement,
    // The accessible-name algorithm pads the inline Terms button with spaces.
    terms: screen.getByRole("checkbox", {
      name: (n) => n.startsWith(en.ticks.terms.before.trim()) && n.includes(en.ticks.terms.link),
    }) as HTMLInputElement,
    optIn: screen.getByRole("checkbox", { name: en.ticks.optIn }) as HTMLInputElement,
  };
  const submit = () => fireEvent.click(screen.getByRole("button", { name: en.submit }));
  return { field, submit, submitIdea };
}

function fillValid(field: ReturnType<typeof setup>["field"], series = "morelli") {
  fireEvent.change(field.logline, { target: { value: TYPED.logline } });
  fireEvent.change(field.series, { target: { value: series } });
  fireEvent.change(field.story, { target: { value: TYPED.story } });
  fireEvent.change(field.name, { target: { value: TYPED.name } });
  fireEvent.change(field.email, { target: { value: TYPED.email } });
  fireEvent.click(field.age);
  fireEvent.click(field.terms);
}

const nextButton = () => screen.queryByRole("button", { name: en.barNext });

describe("IdeasLanding — validation after the first send", () => {
  it("an empty send shows the summary and seven pills and focuses the logline", () => {
    const { field, submit, submitIdea } = setup();

    // Nothing is shown before the first attempt.
    expect(screen.queryByRole("alert")).toBeNull();
    submit();

    expect(screen.getByRole("alert").textContent).toContain(en.errors.summary);
    for (const copy of [
      en.errors.loglineRequired,
      en.errors.series,
      en.errors.storyRequired,
      en.errors.nameRequired,
      en.errors.email,
      en.errors.age,
      en.errors.terms,
    ]) {
      expect(screen.getByText(copy)).toBeTruthy();
    }
    // The optional title is fine empty.
    expect(screen.queryByText(en.errors.title)).toBeNull();
    expect(field.logline.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(field.logline);
    expect(submitIdea).not.toHaveBeenCalled();
  });

  it("the first invalid field is focused only once it is marked — aria-invalid and its pill already there", () => {
    const { field, submit } = setup();
    const atFocus: { invalid: string | null; describedBy: string | null }[] = [];
    field.logline.addEventListener("focus", () =>
      atFocus.push({
        invalid: field.logline.getAttribute("aria-invalid"),
        describedBy: field.logline.getAttribute("aria-describedby"),
      }),
    );

    submit();

    expect(atFocus).toHaveLength(1);
    expect(atFocus[0].invalid).toBe("true");
    const pill = screen.getByText(en.errors.loglineRequired).closest("[id]");
    expect(pill).not.toBeNull();
    expect(atFocus[0].describedBy?.split(" ")).toContain(pill!.id);
  });

  it("a server verdict is committed before its field takes focus", async () => {
    const { field, submit } = setup(async () => ({
      ok: false,
      reason: "invalid",
      errors: [{ field: "email", code: "email_invalid" }],
    }));
    let invalidAtFocus: string | null = null;
    field.email.addEventListener("focus", () => {
      invalidAtFocus = field.email.getAttribute("aria-invalid");
    });
    fillValid(field);
    submit();

    await waitFor(() => expect(document.activeElement).toBe(field.email));
    expect(invalidAtFocus).toBe("true");
  });

  it("a field that becomes valid loses its pill; the others stay", () => {
    const { field, submit } = setup();
    submit();

    fireEvent.change(field.logline, { target: { value: "What if the sea froze?" } });

    expect(screen.queryByText(en.errors.loglineRequired)).toBeNull();
    expect(field.logline.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText(en.errors.storyRequired)).toBeTruthy();
  });

  it("over the cap: the counter turns into its chip, nothing is cut", () => {
    const { field } = setup();
    fireEvent.change(field.logline, { target: { value: "x".repeat(301) } });

    expect(screen.getByText("301 / 300 · 1 over")).toBeTruthy();
    expect(field.logline.value).toHaveLength(301);
    expect(field.logline.getAttribute("aria-invalid")).toBe("true");
  });

  it("choosing a show swaps the story placeholder to its {Show} version", () => {
    const { field } = setup();
    expect(field.story.placeholder).toBe(en.story.placeholderNew);
    fireEvent.change(field.series, { target: { value: "morelli" } });
    expect(field.story.placeholder).toBe(en.story.placeholderShow("Morelli"));
    fireEvent.change(field.series, { target: { value: "new" } });
    expect(field.story.placeholder).toBe(en.story.placeholderNew);
  });
});

describe("IdeasLanding — a submit that never reaches React", () => {
  it("is a POST with no named field but the honeypot — nothing typed can land in a URL", () => {
    setup();
    const form = screen.getByRole("form", { name: en.formAria });

    expect(form.getAttribute("method")).toBe("post");
    expect(form.querySelectorAll("[name]:not([name=website])")).toHaveLength(0);
    expect(form.querySelectorAll("[name=website]")).toHaveLength(1);
  });
});

describe("IdeasLanding — sending", () => {
  it("hands submitIdea exactly the form — honeypot empty", async () => {
    const { field, submit, submitIdea } = setup();
    fillValid(field);
    fireEvent.change(field.title, { target: { value: "The Keeper" } });
    submit();

    await waitFor(() => expect(submitIdea).toHaveBeenCalledTimes(1));
    expect(submitIdea).toHaveBeenCalledWith({
      series: "morelli",
      workingTitle: "The Keeper",
      logline: TYPED.logline,
      story: TYPED.story,
      name: TYPED.name,
      email: TYPED.email,
      ageConfirmed: true,
      termsAccepted: true,
      marketingOptIn: false,
      website: "",
    });
  });

  it.each([
    ["rate_limited", en.errors.rateLimited],
    ["server_error", en.errors.generic],
  ] as const)("%s → its pill; every value stays in place", async (reason, copy) => {
    const { field, submit } = setup(async () => ({ ok: false, reason }));
    fillValid(field);
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain(copy);
    expect(field.logline.value).toBe(TYPED.logline);
    expect(field.story.value).toBe(TYPED.story);
    expect(field.email.value).toBe(TYPED.email);
    expect(field.age.checked).toBe(true);
    expect(events.capturePostHog).not.toHaveBeenCalled();
    expect(events.trackPixel).not.toHaveBeenCalled();

    // Editing the address takes the server's pill down.
    fireEvent.change(field.email, { target: { value: "other@example.com" } });
    expect(screen.queryByText(copy)).toBeNull();
  });

  it("a REJECTED action (network drop, stale deploy) → the generic pill, the draft intact", async () => {
    const submitIdea = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { field, submit } = setup(submitIdea);
    fillValid(field);
    submit();

    expect((await screen.findByRole("alert")).textContent).toContain(en.errors.generic);
    // Still the form, not an error boundary — and nothing was cleared.
    expect(screen.getByRole("form", { name: en.formAria })).toBeTruthy();
    expect(field.logline.value).toBe(TYPED.logline);
    expect(field.series.value).toBe("morelli");
    expect(field.story.value).toBe(TYPED.story);
    expect(field.name.value).toBe(TYPED.name);
    expect(field.email.value).toBe(TYPED.email);
    expect(field.terms.checked).toBe(true);
    expect(events.capturePostHog).not.toHaveBeenCalled();
    expect(events.trackPixel).not.toHaveBeenCalled();
  });

  it("the server's series_unknown reads as series_required and clears on change", async () => {
    const { field, submit } = setup(async () => ({
      ok: false,
      reason: "invalid",
      errors: [{ field: "series", code: "series_unknown" }],
    }));
    fillValid(field);
    submit();

    expect(await screen.findByText(en.errors.series)).toBeTruthy();
    expect(document.activeElement).toBe(field.series);
    fireEvent.change(field.series, { target: { value: "new" } });
    expect(screen.queryByText(en.errors.series)).toBeNull();
  });

  it("the button reads «Sending…» and is disabled only while in flight", async () => {
    let resolve!: (r: IdeaSubmissionResult) => void;
    const { field, submit } = setup(
      () => new Promise<IdeaSubmissionResult>((r) => (resolve = r)),
    );
    fillValid(field);
    submit();

    const button = await screen.findByRole("button", { name: en.sending });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ ok: false, reason: "server_error" }));
    const again = screen.getByRole("button", { name: en.submit }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
  });
});

describe("IdeasLanding — success", () => {
  it("replaces chapters 2–3 with the card; «You're on the list» only when onList", async () => {
    const { field, submit } = setup(async () => ({ ok: true, onList: true }));
    fillValid(field);
    submit();

    const card = await screen.findByRole("status");
    expect(within(card).getByText(en.success.title)).toBeTruthy();
    expect(card.textContent).toContain(TYPED.name);
    expect(card.textContent).toContain(TYPED.email);
    expect(within(card).getByText(en.success.onList)).toBeTruthy();
    // The hero field block and the chapters are gone; the H1 stays.
    expect(screen.queryByRole("textbox", { name: en.chapterLabels[1] })).toBeNull();
    expect(screen.queryByRole("button", { name: en.submit })).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    // The page scrolls to THE CARD, and focus — whose button just unmounted —
    // lands on its heading instead of falling back to <body>.
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(card);
    expect(document.activeElement).toBe(within(card).getByRole("heading", { level: 2 }));
  });

  it("no opt-in on the stored row → no «on the list» line", async () => {
    const { field, submit } = setup(async () => ({ ok: true, onList: false }));
    fillValid(field);
    submit();

    await screen.findByRole("status");
    expect(screen.queryByText(en.success.onList)).toBeNull();
  });

  it("«Send another idea» clears everything but the name and the address", async () => {
    const first = setup(async () => ({ ok: true, onList: false }));
    fillValid(first.field);
    fireEvent.change(first.field.title, { target: { value: "The Keeper" } });
    fireEvent.click(first.field.optIn);
    first.submit();
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: en.success.again }));

    const logline = screen.getByRole("textbox", { name: en.chapterLabels[1] }) as HTMLTextAreaElement;
    const series = screen.getByRole("combobox", { name: en.series.label }) as HTMLSelectElement;
    expect(logline.value).toBe("");
    expect(series.value).toBe("");
    expect(
      (screen.getByRole("textbox", { name: en.workingTitle.label }) as HTMLInputElement).value,
    ).toBe("");
    expect((screen.getByRole("textbox", { name: en.story.label }) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByRole("textbox", { name: en.name.label }) as HTMLInputElement).value).toBe(
      TYPED.name,
    );
    expect((screen.getByRole("textbox", { name: en.email.label }) as HTMLInputElement).value).toBe(
      TYPED.email,
    );
    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).checked).toBe(false);
    }
    // A fresh form shows no stale errors.
    expect(screen.queryByRole("alert")).toBeNull();
    // Back to the logline: scrolled to its label, focus in the field.
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(
      screen.getByText(en.chapterLabels[1], { selector: "label" }),
    );
    expect(document.activeElement).toBe(logline);
    // …and the sticky bar is disarmed: out of the field, still no «Next».
    fireEvent.blur(logline);
    expect(nextButton()).toBeNull();
  });
});

describe("IdeasLanding — analytics and logs carry nothing the fan typed", () => {
  it("a continuation: idea_submitted {idea_kind, show_slug} + SubmitApplication {content_category}", async () => {
    const { field, submit } = setup(async () => ({ ok: true, onList: false }));
    fillValid(field, "morelli");
    submit();
    await screen.findByRole("status");

    expect(events.capturePostHog).toHaveBeenCalledTimes(1);
    expect(events.capturePostHog).toHaveBeenCalledWith("idea_submitted", {
      idea_kind: "continuation",
      show_slug: "morelli",
    });
    expect(events.trackPixel).toHaveBeenCalledTimes(1);
    expect(events.trackPixel).toHaveBeenCalledWith("SubmitApplication", {
      content_category: "story_idea",
    });
    const sent = JSON.stringify([
      events.capturePostHog.mock.calls,
      events.trackPixel.mock.calls,
    ]);
    for (const value of Object.values(TYPED)) expect(sent).not.toContain(value);
    expect(sent).not.toContain("MARKER");
  });

  it("a brand-new series: no show_slug at all", async () => {
    const { field, submit } = setup(async () => ({ ok: true, onList: false }));
    fillValid(field, "new");
    submit();
    await screen.findByRole("status");

    expect(events.capturePostHog).toHaveBeenCalledWith("idea_submitted", {
      idea_kind: "new_series",
    });
  });

  it("no console call ever carries a typed value — through validation, a failure and a success", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const submitIdea = vi
      .fn()
      .mockRejectedValueOnce(new Error(`insert failed: ${TYPED.email} ${TYPED.story}`))
      .mockResolvedValueOnce({ ok: true, onList: true });
    const { field, submit } = setup(submitIdea);

    submit(); // client validation
    fillValid(field);
    submit(); // rejected
    await screen.findByText(en.errors.generic);
    await screen.findByRole("button", { name: en.submit }); // out of flight
    submit(); // succeeds
    await screen.findByRole("status");

    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    for (const value of Object.values(TYPED)) expect(logged).not.toContain(value);
    expect(logged).not.toContain("MARKER");
  });
});

describe("IdeasLanding — the sticky bar (phones)", () => {
  it("arms on the first logline character and hides while a field has focus", () => {
    const { field } = setup();
    expect(nextButton()).toBeNull();

    fireEvent.focus(field.logline);
    fireEvent.change(field.logline, { target: { value: "W" } });
    expect(nextButton()).toBeNull(); // typing — keyboard up

    fireEvent.blur(field.logline);
    expect(nextButton()).not.toBeNull();

    fireEvent.focus(field.email);
    expect(nextButton()).toBeNull();
    fireEvent.blur(field.email);
    expect(nextButton()).not.toBeNull();
  });

  it("hides while the submit button is on screen", () => {
    const { field } = setup();
    fireEvent.change(field.logline, { target: { value: "W" } });
    expect(nextButton()).not.toBeNull();

    act(() => {
      for (const cb of observerCallbacks) {
        cb(
          [
            {
              isIntersecting: true,
              boundingClientRect: { top: 400 } as DOMRectReadOnly,
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      }
    });
    expect(nextButton()).toBeNull();
  });

  it("stays out of the cookie banner's way until it is answered", () => {
    const banner = document.createElement("div");
    banner.setAttribute("data-cookie-banner", "");
    document.body.appendChild(banner);
    const { field } = setup();

    fireEvent.change(field.logline, { target: { value: "W" } });
    expect(nextButton()).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: { marketing: false } }));
    });
    expect(nextButton()).not.toBeNull();

    // Reopened from the footer's "Cookie preferences".
    act(() => {
      window.dispatchEvent(new Event(COOKIE_PREFS_EVENT));
    });
    expect(nextButton()).toBeNull();
  });

  it("«Next» jumps to the first missing required field: series → logline → story → …", () => {
    const { field } = setup();
    fireEvent.change(field.logline, { target: { value: "What if the sea froze?" } });

    fireEvent.click(nextButton()!);
    expect(document.activeElement).toBe(field.series);

    fireEvent.change(field.series, { target: { value: "morelli" } });
    fireEvent.blur(field.series);
    fireEvent.click(nextButton()!);
    expect(document.activeElement).toBe(field.story);
  });

  it("never submits the form", () => {
    const { field, submitIdea } = setup();
    fillValid(field);
    fireEvent.click(nextButton()!);
    expect(submitIdea).not.toHaveBeenCalled();
  });
});

describe("IdeasLanding — the hero CTA and the Terms sheet", () => {
  it("«Pitch your story» scrolls to chapter 2 and focuses the select", () => {
    const { field } = setup();
    fireEvent.click(screen.getByRole("button", { name: en.pitchCta }));
    // The element scrolled to the top is chapter 2 — its label and select
    // inside, chapter 3's fields not.
    const target = scrollIntoView.mock.contexts.at(-1) as Element;
    expect(scrollIntoView.mock.calls.at(-1)?.[0]).toMatchObject({ block: "start" });
    expect(target.contains(screen.getByText(en.chapter(2)))).toBe(true);
    expect(target.contains(field.series)).toBe(true);
    expect(target.contains(field.name)).toBe(false);
    expect(document.activeElement).toBe(field.series);
  });

  it("opens from tick 2, closes on Esc, and the draft is untouched", async () => {
    const { field } = setup();
    fireEvent.change(field.logline, { target: { value: TYPED.logline } });

    fireEvent.click(screen.getByRole("button", { name: en.ticks.terms.link }));
    const dialog = await screen.findByRole("dialog", { name: en.terms.title });
    expect(within(dialog).getByText(en.terms.version)).toBeTruthy();
    // The counsel notes of the mockup are never rendered.
    expect(dialog.textContent).not.toContain("COUNSEL");

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Focus comes back to tick 2 — the box the Terms belong to.
    await waitFor(() => expect(document.activeElement).toBe(field.terms));
    expect(field.logline.value).toBe(TYPED.logline);
  });

  it("the FAQ's «Idea Submission Terms» opens the same sheet", async () => {
    setup(undefined, { withFaq: true });
    const faq = screen.getByRole("region", { name: en.faq.title });
    fireEvent.click(within(faq).getByRole("button", { name: en.faq.owns.a.link }));
    expect(await screen.findByRole("dialog", { name: en.terms.title })).toBeTruthy();
  });
});

describe("hero focus (#370): which part of a 16:9 still a phone keeps", () => {
  // A phone shows only a ~30%-wide vertical slice of the hero still, so the
  // anchor decides who is on screen: a show hero keeps its subject right of
  // centre, the landing's own photo keeps the heroine on the left third.
  const heroImg = (container: HTMLElement) => {
    const img = container.querySelector("section img");
    expect(img).not.toBeNull();
    return img as HTMLImageElement;
  };

  it("the landing's own photo is anchored on the heroine", () => {
    const { container } = render(
      <IdeasLanding
        locale="en"
        shows={SHOWS}
        preselectedSlug={null}
        heroImageUrl="/ideas/hero.jpg"
        heroFocus="landing"
        submitIdea={vi.fn()}
      />,
    );
    const img = heroImg(container);
    expect(img.classList.contains("object-[26%_30%]")).toBe(true);
    expect(img.classList.contains("object-[62%_30%]")).toBe(false);
  });

  it("a show hero keeps the show anchor (the default)", () => {
    const { container } = render(
      <IdeasLanding
        locale="en"
        shows={SHOWS}
        preselectedSlug="morelli"
        heroImageUrl="/shows/morelli-hero.png"
        submitIdea={vi.fn()}
      />,
    );
    const img = heroImg(container);
    expect(img.classList.contains("object-[62%_30%]")).toBe(true);
    expect(img.classList.contains("object-[26%_30%]")).toBe(false);
  });
});
