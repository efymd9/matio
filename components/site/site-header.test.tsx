/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { isNextLink, prefetchOf } from "@/tools/test/next-link-probe";

// `prefetch={false}` leaves no trace in the HTML — the probe records it.
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// The real module pulls the locale server action in; the header only reads.
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return {
    useT: () => en,
    useLocale: () => "en",
    useSetLocale: () => ({ setLocale: () => undefined, isPending: false }),
  };
});

import { SiteHeader } from "./site-header";

afterEach(cleanup);

describe("SiteHeader — the /subscribe link is never prefetched (#259)", () => {
  // Why: for a signed-out visitor proxy.ts answers /subscribe with a 307 to
  // Clerk's origin. next/link's prefetch fetch cannot follow a cross-origin
  // redirect (CORS) and rejects as an unhandled "Failed to fetch" — one Sentry
  // event per header that renders. It stays a next/link: a signed-in visitor
  // gets client navigation on click.

  it("desktop nav: a next/link with prefetch switched off", () => {
    render(<SiteHeader authSlot={null} paymentsEnabled />);

    const subscribe = screen.getByRole("link", { name: en.header.subscribe });
    expect(subscribe.getAttribute("href")).toBe("/subscribe");
    expect(isNextLink(subscribe)).toBe(true);
    expect(prefetchOf(subscribe)).toBe("false");
  });

  it("mobile menu: the same rule on the menu item", () => {
    // The popup is portaled and exists only while open; opened, its items are
    // on screen — which is exactly when next/link would prefetch them.
    render(<SiteHeader authSlot={null} paymentsEnabled />);
    fireEvent.click(screen.getByRole("button", { name: en.header.menuAria }));

    const item = screen.getByRole("menuitem", { name: en.header.subscribe });
    expect(item.getAttribute("href")).toBe("/subscribe");
    expect(isNextLink(item)).toBe(true);
    expect(prefetchOf(item)).toBe("false");
  });

  it("leaves the other nav links on next/link's default prefetch", () => {
    // The control: /subscribe is the exception, not a header-wide switch.
    render(<SiteHeader authSlot={null} paymentsEnabled />);
    fireEvent.click(screen.getByRole("button", { name: en.header.menuAria }));

    const about = [
      screen.getByRole("link", { name: en.footer.about }),
      screen.getByRole("menuitem", { name: en.footer.about }),
    ];
    for (const a of about) {
      expect(a.getAttribute("href")).toBe("/about");
      expect(isNextLink(a)).toBe(true);
      expect(prefetchOf(a)).toBe("default");
    }
  });
});
