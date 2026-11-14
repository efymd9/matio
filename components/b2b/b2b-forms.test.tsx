/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnquiryResult } from "@/lib/b2b-enquiry";
import { studio } from "@/lib/i18n/b2b-dictionaries";

// The two business forms (#498) in jsdom: local validation before any round
// trip, the server's answers (codes, the brake, a failure, a REJECTED
// action), the success card, the preselected title — and that the analytics
// event carries nothing but its name.

const events = vi.hoisted(() => ({ capturePostHog: vi.fn() }));
vi.mock("@/lib/posthog-events", () => ({ capturePostHog: events.capturePostHog }));

import { ScreenerRequestForm, StudioBriefForm } from "./b2b-forms";

afterEach(() => {
  cleanup();
  events.capturePostHog.mockReset();
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function fillBrief() {
  type("Your name", "Marker Producer 9Z");
  type("Email", "marker.9z@example.com");
  fireEvent.change(screen.getByLabelText("What do you need?"), { target: { value: "series" } });
  type("Short brief", "MARKER-BRIEF-9Z a pilot");
}

describe("StudioBriefForm", () => {
  it("an empty send stays local: field errors, a summary, the focus on the first field", () => {
    const submit = vi.fn();
    render(<StudioBriefForm submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Send brief" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getAllByText("This field is required.")).toHaveLength(4);
    expect(screen.getByRole("alert").textContent).toBe("Please fix 4 fields above.");
    expect(document.activeElement).toBe(screen.getByLabelText("Your name"));
    expect(screen.getByLabelText("Your name").getAttribute("aria-invalid")).toBe("true");
  });

  it("sends the brief, shows the success card and fires a bare event", async () => {
    const submit = vi.fn(async (): Promise<EnquiryResult> => ({ ok: true }));
    render(<StudioBriefForm submit={submit} />);
    fillBrief();
    fireEvent.click(screen.getByRole("button", { name: "Send brief" }));
    await screen.findByText("Brief received");
    expect(submit).toHaveBeenCalledWith({
      name: "Marker Producer 9Z",
      email: "marker.9z@example.com",
      projectType: "series",
      brief: "MARKER-BRIEF-9Z a pilot",
      timeline: "",
      budget: "",
      website: "",
    });
    expect(events.capturePostHog.mock.calls).toEqual([["studio_brief_submitted"]]);

    // "Send another" starts over with an empty form.
    fireEvent.click(screen.getByRole("button", { name: studio.form.sendAnother }));
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("");
  });

  it("shows the server's field codes, the brake and a failure — a rejected action included", async () => {
    const submit = vi
      .fn<() => Promise<EnquiryResult>>()
      .mockResolvedValueOnce({ ok: false, reason: "invalid", errors: [{ field: "email", code: "invalid_email" }] })
      .mockResolvedValueOnce({ ok: false, reason: "rate_limited" })
      .mockRejectedValueOnce(new Error("network"));
    render(<StudioBriefForm submit={submit} />);
    fillBrief();
    // The button reads "Sending…" until the transition settles — wait for it.
    const send = async () =>
      fireEvent.click(await screen.findByRole("button", { name: "Send brief" }));

    await send();
    await screen.findByText(studio.form.errors.invalid_email);
    await send();
    await screen.findByText(studio.form.rateLimited);
    await send();
    await screen.findByText(studio.form.serverError);
    expect(events.capturePostHog).not.toHaveBeenCalled();
  });
});

describe("ScreenerRequestForm", () => {
  const TITLES = [{ slug: "the-scarlet-oath", title: "THE SCARLET OATH" }];

  it("preselects the title a card linked to and passes it to the action", async () => {
    const submit = vi.fn(async (): Promise<EnquiryResult> => ({ ok: true }));
    render(
      <ScreenerRequestForm titles={TITLES} preselected="the-scarlet-oath" submit={submit} />,
    );
    expect((screen.getByLabelText("Title") as HTMLSelectElement).value).toBe("the-scarlet-oath");
    type("Your name", "Ana");
    type("Company", "Northern Screens");
    type("Work email", "ana@northern.example");
    type("Market or territory", "Nordics");
    fireEvent.click(screen.getByRole("button", { name: "Request screener" }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]).toEqual([
      {
        title: "the-scarlet-oath",
        name: "Ana",
        company: "Northern Screens",
        email: "ana@northern.example",
        market: "Nordics",
        website: "",
      },
    ]);
    await screen.findByText("Request received");
    expect(events.capturePostHog.mock.calls).toEqual([["screener_requested"]]);
  });

  it("has no title picker while no title is confirmed, and ignores an unknown preselect", () => {
    const { unmount } = render(
      <ScreenerRequestForm titles={[]} preselected={null} submit={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Title")).toBeNull();
    unmount();
    render(<ScreenerRequestForm titles={TITLES} preselected="fallen" submit={vi.fn()} />);
    expect((screen.getByLabelText("Title") as HTMLSelectElement).value).toBe("");
  });

  it("puts nothing personal in a `name` attribute — only the honeypot has one", () => {
    const { container } = render(
      <ScreenerRequestForm titles={TITLES} preselected={null} submit={vi.fn()} />,
    );
    const named = [...container.querySelectorAll("[name]")].map((el) => el.getAttribute("name"));
    expect(named).toEqual(["website"]);
    expect(container.querySelector("form")?.getAttribute("method")).toBe("post");
  });
});
