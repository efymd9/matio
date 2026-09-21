/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { isNextLink, prefetchOf } from "@/tools/test/next-link-probe";

// `prefetch={false}` leaves no trace in the HTML — the probe records it
// (see its header; shared with the #259 suites).
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

import { RateLimitedNotice } from "./playback-status";

afterEach(cleanup);

describe("RateLimitedNotice — the /subscribe link is never prefetched (#260)", () => {
  // Why: the 429 behind this notice comes from the trial branch of the token
  // route, so the viewer looking at it is usually signed out. For them
  // proxy.ts answers /subscribe with a 307 to Clerk's origin; next/link's
  // prefetch fetch cannot follow a cross-origin redirect (CORS) and rejects as
  // an unhandled "Failed to fetch" — the same Sentry class as #259.

  it("Subscribe stays a next/link, with prefetch switched off", () => {
    render(<RateLimitedNotice showSlug="the-scarlet-oath" />);

    const subscribe = screen.getByRole("link", {
      name: en.watch.rateLimitedSubscribe,
    });
    expect(subscribe.getAttribute("href")).toBe(
      "/subscribe?show=the-scarlet-oath",
    );
    // Still next/link: a signed-in non-subscriber gets client navigation.
    expect(isNextLink(subscribe)).toBe(true);
    expect(prefetchOf(subscribe)).toBe("false");
  });

  it("leaves the neighbouring show link on next/link's default prefetch", () => {
    // The control: /subscribe is the exception, not a notice-wide switch —
    // the show page is an ordinary public page and keeps its prefetch.
    render(<RateLimitedNotice showSlug="the-scarlet-oath" />);

    const back = screen.getByRole("link", { name: en.watch.rateLimitedBack });
    expect(back.getAttribute("href")).toBe("/shows/the-scarlet-oath");
    expect(isNextLink(back)).toBe(true);
    expect(prefetchOf(back)).toBe("default");
  });
});
