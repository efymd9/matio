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

// Everything a consented visit (or the old geo default) can leave behind
// that /cookies lists under Marketing — by the names the browser holds.
const MARKETING_LEFTOVERS = [
  "attribution_first",
  "attribution_last",
  "_fbp",
  "_fbc",
  "__oppref",
  "muxData",
  "mux_viewer_id",
  "_ga",
  "_ga_9FS22EEF6K",
  "ph_phc_test_posthog",
];

afterEach(() => {
  cleanup();
  for (const name of ["cookie_consent", ...MARKETING_LEFTOVERS]) {
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

  // Size only: the two are NOT visually equal (filled gold CTA vs outlined),
  // and whether that asymmetry is acceptable is a counsel question (#466 row
  // in docs/registry.md) — this test claims no more than it checks.
  it("gives both answers the same height, one tap each", () => {
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

  it("«Essential only» stores a no at the current version and clears every marketing cookie /cookies lists", () => {
    for (const name of MARKETING_LEFTOVERS) {
      document.cookie = `${name}=left-over; path=/`;
    }
    document.cookie = "matio_aid=keep; path=/";
    render(<CookieBanner initialConsent={null} />);
    fireEvent.click(screen.getByRole("button", { name: en.cookieBanner.essentialOnly }));
    expect(readConsentFromDocument()).toMatchObject({ marketing: false, v: CONSENT_VERSION });
    const held = document.cookie.split("; ").map((pair) => pair.split("=")[0]);
    for (const name of MARKETING_LEFTOVERS) {
      expect(held, name).not.toContain(name);
    }
    // Strictly necessary cookies stay.
    expect(held).toContain("matio_aid");
    expect(held).toContain("cookie_consent");
    document.cookie = "matio_aid=; max-age=0; path=/";
  });

  it("clears what a v1 record let in as soon as it mounts — before any answer", () => {
    document.cookie = `cookie_consent=${encodeURIComponent(
      JSON.stringify({ necessary: true, marketing: true, ts: 1, v: 1 }),
    )}; path=/`;
    for (const name of MARKETING_LEFTOVERS) {
      document.cookie = `${name}=geo-default-era; path=/`;
    }
    render(<CookieBanner initialConsent={readConsentFromDocument()} />);
    expect(dialog()).not.toBeNull();
    const held = document.cookie.split("; ").map((pair) => pair.split("=")[0]);
    for (const name of MARKETING_LEFTOVERS) {
      expect(held, name).not.toContain(name);
    }
  });

  it("leaves the marketing cookies of a current record alone, and has nothing to clear without a record", () => {
    document.cookie = `cookie_consent=${encodeURIComponent(
      JSON.stringify({ necessary: true, marketing: true, ts: 1, v: CONSENT_VERSION }),
    )}; path=/`;
    document.cookie = "attribution_first=consented; path=/";
    render(<CookieBanner initialConsent={readConsentFromDocument()} />);
    expect(document.cookie).toContain("attribution_first=consented");
    cleanup();

    document.cookie = "cookie_consent=; max-age=0; path=/";
    render(<CookieBanner initialConsent={null} />);
    // No record at all: nothing marketing could have been written under it,
    // and the banner simply asks.
    expect(document.cookie).toContain("attribution_first=consented");
  });
});
