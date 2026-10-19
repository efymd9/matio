/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONSENT_VERSION,
  COOKIE_PREFS_EVENT,
  parseConsent,
  readConsentFromDocument,
} from "@/lib/cookie-consent";
import { en } from "@/lib/i18n/dictionaries";

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

import { CookieBanner } from "./cookie-banner";

afterEach(() => {
  cleanup();
  for (const name of ["cookie_consent", "attribution_first", "_fbp", "_fbc", "muxData"]) {
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

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
      <CookieBanner
        initialConsent={{ necessary: true, marketing: true, ts: 1, v: CONSENT_VERSION }}
      />,
    );
    expect(marker()).toBeNull();
  });
});

// #466 — the banner is for every visitor, in every country: nothing writes a
// default record any more, and the records proxy.ts used to write by itself
// (v1) are asked again. What a visitor answers is stored at the current
// version; "Essential only" also takes the marketing cookies with it.
describe("CookieBanner — asked of everyone (#466)", () => {
  const dialog = () => document.querySelector("[data-cookie-banner]");

  it("shows for a v1 record — even one that says yes", () => {
    const stale = parseConsent(
      JSON.stringify({ necessary: true, marketing: true, ts: 1, v: 1 }),
    );
    render(<CookieBanner initialConsent={stale} />);
    expect(dialog()).not.toBeNull();
  });

  it("keeps both answers equally at hand", () => {
    render(<CookieBanner initialConsent={null} />);
    const accept = screen.getByRole("button", { name: en.cookieBanner.acceptAll });
    const reject = screen.getByRole("button", { name: en.cookieBanner.essentialOnly });
    expect(accept.className).toContain("h-11");
    expect(reject.className).toContain("h-11");
  });

  it("«Accept all» stores a yes at the current version", () => {
    render(<CookieBanner initialConsent={null} />);
    fireEvent.click(screen.getByRole("button", { name: en.cookieBanner.acceptAll }));
    expect(readConsentFromDocument()).toMatchObject({ marketing: true, v: CONSENT_VERSION });
    expect(dialog()).toBeNull();
  });

  it("«Essential only» stores a no at the current version and clears the marketing cookies", () => {
    for (const name of ["attribution_first", "_fbp", "_fbc", "muxData"]) {
      document.cookie = `${name}=left-over; path=/`;
    }
    render(<CookieBanner initialConsent={null} />);
    fireEvent.click(screen.getByRole("button", { name: en.cookieBanner.essentialOnly }));
    expect(readConsentFromDocument()).toMatchObject({ marketing: false, v: CONSENT_VERSION });
    for (const name of ["attribution_first", "_fbp", "_fbc", "muxData"]) {
      expect(document.cookie, name).not.toContain(`${name}=`);
    }
  });
});
