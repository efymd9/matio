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

import type { JobPosition, Vacancy } from "@/lib/careers";
import { VACANCIES, VACANCY_LIST } from "@/lib/careers";
import { CONSENT_CHANGED_EVENT, COOKIE_PREFS_EVENT } from "@/lib/cookie-consent";
import { en } from "@/lib/i18n/careers-dictionaries";
import type { JobApplicationInput, JobApplicationResult } from "@/lib/job-application";

// The /careers page's behaviour (#376), in jsdom: the two role cards and
// their Apply, the position picker, validation after the first send (the
// spec's cases: everything empty, AI Creator without a portfolio, Sales
// without one, a javascript: link, a fifth profile), the server's failure
// answers and a REJECTED action, the success card, the analytics payload,
// the phone bar — and that nothing the candidate typed reaches the console
// or an event. The layout itself lives in the Lab stories.

const events = vi.hoisted(() => ({ capturePostHog: vi.fn() }));
vi.mock("@/lib/posthog-events", () => ({ capturePostHog: events.capturePostHog }));

import { CareersFaq } from "./careers-faq";
import { CareersLanding } from "./careers-landing";

// Recognisable values — if any of them shows up in a log line or an event,
// the assertion names it.
const TYPED = {
  fullName: "Marker Candidate 7Q",
  email: "Marker.7Q@Example.com",
  location: "Markerville 7Q, Spain",
  portfolio: "https://marker-7q.example.com/reel",
  message: "MARKER-ABOUT-7Q I cut trailers.",
};

// jsdom has neither IntersectionObserver nor scrollIntoView. The observer
// stub keeps its callback so a test can say "the form is on screen".
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
  scrollIntoView.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  document.querySelectorAll("[data-cookie-banner]").forEach((n) => n.remove());
});

type Submit = (input: JobApplicationInput) => Promise<JobApplicationResult>;

function setup(
  submit: Submit = vi.fn(async () => ({ ok: true }) as JobApplicationResult),
  props: { preselected?: JobPosition | null; vacancies?: readonly Vacancy[]; withFaq?: boolean } = {},
) {
  render(
    <CareersLanding
      vacancies={props.vacancies}
      preselectedPosition={props.preselected ?? null}
      submitJobApplication={submit}
      faq={props.withFaq ? <CareersFaq t={en} /> : undefined}
    />,
  );
  const form = screen.getByRole("form", { name: en.form.aria });
  const f = within(form);
  const field = {
    aiCreator: f.getByRole("radio", { name: "AI Creator" }) as HTMLInputElement,
    sales: f.getByRole("radio", { name: "Sales & Distribution" }) as HTMLInputElement,
    fullName: f.getByRole("textbox", { name: en.form.fullName.label }) as HTMLInputElement,
    email: f.getByRole("textbox", { name: en.form.email.label }) as HTMLInputElement,
    location: f.getByRole("textbox", { name: en.form.location.label }) as HTMLInputElement,
    linkedin: f.getByRole("textbox", { name: /^LinkedIn/ }) as HTMLInputElement,
    message: f.getByRole("textbox", { name: en.form.about.label }) as HTMLTextAreaElement,
    age: f.getByRole("checkbox", { name: en.form.age }) as HTMLInputElement,
  };
  const portfolio = () =>
    f.getByRole("textbox", {
      name: /^(Portfolio or reel|Website or other work|Portfolio or work)/,
    }) as HTMLInputElement;
  const social = (n: number) =>
    f.getByRole("textbox", { name: en.form.socials.value(n) }) as HTMLInputElement;
  const send = () => fireEvent.click(f.getByRole("button", { name: en.form.submit }));
  return { form, field, portfolio, social, send, submit };
}

function fillValid(s: ReturnType<typeof setup>, role: "ai" | "sales" = "ai") {
  fireEvent.click(role === "ai" ? s.field.aiCreator : s.field.sales);
  fireEvent.change(s.field.fullName, { target: { value: TYPED.fullName } });
  fireEvent.change(s.field.email, { target: { value: TYPED.email } });
  fireEvent.change(s.field.location, { target: { value: TYPED.location } });
  if (role === "ai") fireEvent.change(s.portfolio(), { target: { value: TYPED.portfolio } });
  fireEvent.change(s.field.message, { target: { value: TYPED.message } });
  fireEvent.click(s.field.age);
}

describe("CareersLanding — the page", () => {
  it("shows the hero, both roles with their duties and requirements, and no fact row while the facts are null", () => {
    setup();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("We arehiring.");
    for (const v of VACANCY_LIST) {
      const card = screen.getByRole("article", { name: v.title });
      expect(card.id).toBe(v.id);
      for (const line of [v.summary, ...v.whatYoullDo, ...v.whatWereLookingFor]) {
        expect(within(card).getByText(line)).toBeTruthy();
      }
      expect(within(card).queryByText(en.roles.location)).toBeNull();
      expect(within(card).queryByText(en.roles.employmentType)).toBeNull();
      // Without JavaScript the Apply link itself preselects the role.
      expect(
        within(card).getByRole("link", { name: en.roles.applyAria(v.title) }).getAttribute("href"),
      ).toBe(`?role=${v.id}#apply`);
    }
  });

  it("draws a fact row once a role has one — and only that one", () => {
    const withFacts: Vacancy[] = [
      { ...VACANCIES["ai-creator"], location: "Remote", employmentType: null },
      VACANCIES["sales-distribution"],
    ];
    setup(undefined, { vacancies: withFacts });

    const card = screen.getByRole("article", { name: "AI Creator" });
    expect(within(card).getByText(en.roles.location)).toBeTruthy();
    expect(within(card).getByText("Remote")).toBeTruthy();
    expect(within(card).queryByText(en.roles.employmentType)).toBeNull();
  });

  it("a card's Apply picks that role in the form and goes there", () => {
    const s = setup();
    const card = screen.getByRole("article", { name: "Sales & Distribution Manager" });

    fireEvent.click(
      within(card).getByRole("link", { name: en.roles.applyAria("Sales & Distribution Manager") }),
    );

    expect(s.field.sales.checked).toBe(true);
    expect(s.field.aiCreator.checked).toBe(false);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(s.field.sales);
  });

  it("the role picker is ONE radio group — a shared name, so arrow keys move within it and it is one Tab stop", () => {
    const s = setup();
    expect(s.field.aiCreator.name).toBe("position");
    expect(s.field.sales.name).toBe("position");
    expect(s.field.aiCreator.value).toBe("ai-creator");
    expect(s.field.sales.value).toBe("sales-distribution");
    // Checking one unchecks the other, natively, within the group.
    fireEvent.click(s.field.sales);
    expect(s.field.sales.checked).toBe(true);
    expect(s.field.aiCreator.checked).toBe(false);
    // No other field carries a name: nothing personal could ride a native submit.
    const named = [...s.form.querySelectorAll("[name]")].map((el) => el.getAttribute("name"));
    expect([...new Set(named)].sort()).toEqual(["position", "website"]);
  });

  it("an address with something in it but no @ gets the malformed copy, not the empty one", () => {
    const s = setup();
    fillValid(s);
    fireEvent.change(s.field.email, { target: { value: "marker-at-example.com" } });

    s.send();

    expect(screen.getByText(en.errors.email)).toBeTruthy();
    expect(screen.queryByText(en.errors.emailRequired)).toBeNull();
  });

  it("the hero CTA goes to the roles", () => {
    setup();
    fireEvent.click(screen.getByRole("link", { name: new RegExp(en.hero.cta) }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById("roles"));
  });

  it("?role= arrives preselected, and the role tunes the portfolio label and the About-you hint", () => {
    const s = setup(undefined, { preselected: "sales-distribution" });

    expect(s.field.sales.checked).toBe(true);
    expect(s.portfolio().labels?.[0]?.textContent).toBe("Website or other work" + en.form.optional);
    expect(screen.getByText(VACANCIES["sales-distribution"].aboutHint)).toBeTruthy();

    fireEvent.click(s.field.aiCreator);
    // AI Creator needs it: no Optional tag any more.
    expect(s.portfolio().labels?.[0]?.textContent).toBe("Portfolio or reel");
    expect(screen.getByText(VACANCIES["ai-creator"].aboutHint)).toBeTruthy();
  });

  it("renders the FAQ it is handed, with the /ideas and mail links", () => {
    setup(undefined, { withFaq: true });
    expect(screen.getByRole("heading", { name: en.faq.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.faq.ideas.a.link }).getAttribute("href")).toBe("/ideas");
    expect(screen.getByRole("link", { name: en.faq.data.a.link }).getAttribute("href")).toBe(
      `mailto:${en.faq.data.a.link}`,
    );
  });
});

describe("CareersLanding — validation after the first send", () => {
  it("an empty send shows the summary and every required pill, focuses the role and sends nothing", () => {
    const s = setup();
    expect(screen.queryByRole("alert")).toBeNull();

    s.send();

    expect(screen.getByRole("alert").textContent).toContain(en.errors.summary);
    for (const copy of [
      en.errors.position,
      en.errors.nameRequired,
      en.errors.emailRequired,
      en.errors.locationRequired,
      en.errors.messageRequired,
      en.errors.age,
    ]) {
      expect(screen.getByText(copy)).toBeTruthy();
    }
    expect(screen.queryByText(en.errors.email)).toBeNull();
    expect(s.submit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(s.field.aiCreator);
    expect(s.field.fullName.getAttribute("aria-invalid")).toBe("true");
  });

  it("AI Creator without a portfolio is refused at the portfolio", () => {
    const s = setup();
    fillValid(s);
    fireEvent.change(s.portfolio(), { target: { value: "" } });

    s.send();

    expect(screen.getByText(en.errors.portfolioRequired)).toBeTruthy();
    expect(document.activeElement).toBe(s.portfolio());
    expect(s.submit).not.toHaveBeenCalled();
  });

  it("Sales & Distribution without a portfolio is sent", async () => {
    const s = setup();
    fillValid(s, "sales");

    s.send();

    await waitFor(() => expect(s.submit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(s.submit).mock.calls[0][0]).toMatchObject({
      position: "sales-distribution",
      portfolioUrl: "",
    });
  });

  it("a javascript: link is refused", () => {
    const s = setup();
    fillValid(s);
    fireEvent.change(s.field.linkedin, { target: { value: "javascript:alert(1)" } });

    s.send();

    expect(screen.getByText(en.errors.link)).toBeTruthy();
    expect(document.activeElement).toBe(s.field.linkedin);
    expect(s.submit).not.toHaveBeenCalled();
  });

  it("a bad profile is marked on its own row", () => {
    const s = setup();
    fillValid(s);
    fireEvent.change(s.social(1), { target: { value: "not a handle" } });

    s.send();

    expect(s.social(1).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(en.errors.social)).toBeTruthy();
    expect(document.activeElement).toBe(s.social(1));
    expect(s.submit).not.toHaveBeenCalled();
  });

  it("a counter shows the message length, and how far over the cap it is", () => {
    const s = setup();
    fireEvent.change(s.field.message, { target: { value: "x".repeat(2003) } });
    expect(screen.getByText("2,003 / 2,000 · 3 over")).toBeTruthy();
    expect(s.field.message.getAttribute("aria-invalid")).toBe("true");
  });

  it("an edited field loses the server's verdict on it", async () => {
    const submit = vi.fn(async () => ({
      ok: false as const,
      reason: "invalid" as const,
      errors: [{ field: "location" as const, code: "location_too_long" as const }],
    }));
    const s = setup(submit);
    fillValid(s);
    s.send();
    expect(await screen.findByText(en.errors.locationTooLong)).toBeTruthy();

    fireEvent.change(s.field.location, { target: { value: "Madrid" } });

    expect(screen.queryByText(en.errors.locationTooLong)).toBeNull();
  });
});

describe("CareersLanding — social profiles", () => {
  it("adds rows up to four, then the Add button is gone — a fifth cannot be made", () => {
    const s = setup();
    const add = () => screen.getByRole("button", { name: en.form.socials.add });

    fireEvent.click(add());
    fireEvent.click(add());
    fireEvent.click(add());

    expect(s.social(4)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.form.socials.add })).toBeNull();
    // Each new row starts on a platform not used yet.
    expect(
      [1, 2, 3, 4].map(
        (n) =>
          (screen.getByRole("combobox", { name: en.form.socials.platform(n) }) as HTMLSelectElement)
            .value,
      ),
    ).toEqual(["tiktok", "instagram", "youtube", "x"]);
  });

  it("removes a row and sends what is filled, platform and value", async () => {
    const s = setup();
    fillValid(s);
    fireEvent.click(screen.getByRole("button", { name: en.form.socials.add }));
    fireEvent.change(s.social(1), { target: { value: "@marker.7q" } });
    fireEvent.change(screen.getByRole("combobox", { name: en.form.socials.platform(2) }), {
      target: { value: "other" },
    });
    fireEvent.change(s.social(2), { target: { value: "https://other.example.com/me" } });
    fireEvent.click(screen.getByRole("button", { name: en.form.socials.remove(1) }));

    s.send();

    await waitFor(() => expect(s.submit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(s.submit).mock.calls[0][0].socials).toEqual([
      { platform: "other", value: "https://other.example.com/me" },
    ]);
  });
});

describe("CareersLanding — the server's answers", () => {
  it("success: the card replaces the form, greets by first name, names the address, and sends one event — the role only", async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m),
    );
    const s = setup();
    fillValid(s);

    s.send();

    const title = await screen.findByRole("heading", { name: "Thanks, Marker." });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByRole("form", { name: en.form.aria })).toBeNull();
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(TYPED.email);
    expect(within(status).getByRole("link", { name: en.success.watch }).getAttribute("href")).toBe("/");
    expect(events.capturePostHog).toHaveBeenCalledWith("job_application_submitted", {
      position: "ai-creator",
    });
    const leaked = JSON.stringify([
      events.capturePostHog.mock.calls,
      consoleSpies.map((spy) => spy.mock.calls),
    ]);
    for (const value of Object.values(TYPED)) expect(leaked).not.toContain(value);
    expect(vi.mocked(s.submit).mock.calls[0][0]).toMatchObject({
      position: "ai-creator",
      fullName: TYPED.fullName,
      email: TYPED.email,
      website: "",
    });
  });

  it("the honeypot's value goes to the server, which decides", async () => {
    const s = setup();
    fillValid(s);
    const trap = s.form.querySelector("input[name=website]") as HTMLInputElement;
    trap.value = "https://bot.example.invalid";

    s.send();

    await waitFor(() => expect(s.submit).toHaveBeenCalledTimes(1));
    expect(vi.mocked(s.submit).mock.calls[0][0].website).toBe("https://bot.example.invalid");
  });

  it.each([
    ["rate_limited", en.errors.rateLimited],
    ["server_error", en.errors.generic],
  ] as const)("%s keeps the draft and says so", async (reason, copy) => {
    const s = setup(vi.fn(async () => ({ ok: false as const, reason })));
    fillValid(s);

    s.send();

    expect(await screen.findByText(copy)).toBeTruthy();
    expect(s.field.fullName.value).toBe(TYPED.fullName);
    expect(events.capturePostHog).not.toHaveBeenCalled();
    // Editing the address takes the pill down.
    fireEvent.change(s.field.email, { target: { value: "other@example.com" } });
    expect(screen.queryByText(copy)).toBeNull();
  });

  it("a REJECTED action (dropped connection, a deploy) is a generic error, not a blown-up page", async () => {
    const s = setup(vi.fn(async () => Promise.reject(new Error("Failed to find Server Action"))));
    fillValid(s);

    s.send();

    expect(await screen.findByText(en.errors.generic)).toBeTruthy();
    expect(s.field.message.value).toBe(TYPED.message);
  });

  it("a server verdict on a profile marks the row it names", async () => {
    const s = setup(
      vi.fn(async () => ({
        ok: false as const,
        reason: "invalid" as const,
        errors: [{ field: "socials" as const, code: "social_invalid" as const, index: 0 }],
      })),
    );
    fillValid(s);
    fireEvent.change(s.social(1), { target: { value: "@fine" } });

    s.send();

    await waitFor(() => expect(s.social(1).getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(s.social(1));
  });
});

describe("CareersLanding — the phone bar", () => {
  const bar = () =>
    screen.getByText(en.bar.title).closest("[aria-hidden]") as HTMLElement;
  const formIs = (reached: boolean) =>
    act(() => {
      for (const cb of observerCallbacks) {
        cb(
          [
            {
              isIntersecting: reached,
              boundingClientRect: { top: reached ? 100 : 2000 } as DOMRectReadOnly,
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      }
    });

  it("waits for the first look at the screen, shows while the form is below, hides once it is reached", () => {
    setup();
    expect(bar().getAttribute("aria-hidden")).toBe("true");

    formIs(false);
    expect(bar().getAttribute("aria-hidden")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${en.bar.apply}`) }));
    expect(scrollIntoView).toHaveBeenCalled();

    formIs(true);
    expect(bar().getAttribute("aria-hidden")).toBe("true");
  });

  it("stays out of the cookie banner's way, and comes back when the banner closes", () => {
    const banner = document.createElement("div");
    banner.setAttribute("data-cookie-banner", "");
    document.body.appendChild(banner);
    setup();

    formIs(false);
    expect(bar().getAttribute("aria-hidden")).toBe("true");

    act(() => {
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
    });
    expect(bar().getAttribute("aria-hidden")).toBe("false");

    act(() => {
      window.dispatchEvent(new Event(COOKIE_PREFS_EVENT));
    });
    expect(bar().getAttribute("aria-hidden")).toBe("true");
  });
});
