/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COOKIE_PREFS_EVENT } from "@/lib/cookie-consent";
import { en } from "@/lib/i18n/dictionaries";

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

import { CookieBanner } from "./cookie-banner";

afterEach(cleanup);

// The /ideas sticky bar (#297) keeps out of the banner's way by looking for
// the banner's `data-cookie-banner` marker when it arms, then follows the
// banner's own open/close events. The marker is the contract pinned here:
// present exactly while the banner is on screen.
describe("CookieBanner — the data-cookie-banner marker", () => {
  const marker = () => document.querySelector("[data-cookie-banner]");

  it("is on the banner while it shows, and gone once it is answered", () => {
    render(<CookieBanner initialConsent={null} />);
    expect(marker()).not.toBeNull();
    expect(marker()?.getAttribute("role")).toBe("dialog");

    fireEvent.click(screen.getByRole("button", { name: en.cookieBanner.essentialOnly }));
    expect(marker()).toBeNull();

    // Reopened from the footer's "Cookie preferences".
    act(() => {
      window.dispatchEvent(new Event(COOKIE_PREFS_EVENT));
    });
    expect(marker()).not.toBeNull();
  });

  it("is absent when a choice already exists", () => {
    render(
      <CookieBanner initialConsent={{ necessary: true, marketing: true, ts: 1, v: 1 }} />,
    );
    expect(marker()).toBeNull();
  });
});
