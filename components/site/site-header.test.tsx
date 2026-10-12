/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { isNextLink, prefetchOf } from "@/tools/test/next-link-probe";

// `prefetch={false}` leaves no trace in the HTML — the probe records it.
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

// Mutable so a test can put the header on another route (#297); reset to
// "/" after each test.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { SiteHeader } from "./site-header";

// The language switcher is gone with Spanish (#445): no trigger, no EN · ES
// group, no link under /es — on any route.
function expectNoLanguageSwitcher(container: HTMLElement) {
  expect(screen.queryByRole("button", { name: en.language.switchAria })).toBeNull();
  expect(screen.queryByRole("group", { name: en.language.label })).toBeNull();
  expect(container.querySelector("[hreflang]")).toBeNull();
  for (const a of container.querySelectorAll("a")) {
    expect(a.getAttribute("href") ?? "").not.toMatch(/^\/es(?:\/|$)/);
  }
}

afterEach(() => {
  cleanup();
  nav.pathname = "/";
});

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

describe("SiteHeader — the trimmed header on the /ideas landing (#297)", () => {
  // Every exit from a half-written story loses the draft, so the landing's
  // header is the logo — nothing else (the EN · ES toggle it also carried
  // left with Spanish, #445).

  it("/ideas: the logo alone — no nav, no account slot, no menu, no language switcher", () => {
    nav.pathname = "/ideas";
    const { container } = render(
      <SiteHeader
        authSlot={<button type="button">account-slot</button>}
        paymentsEnabled
      />,
    );

    expect(screen.getByRole("link", { name: en.header.home })).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button", { name: "account-slot" })).toBeNull();
    expect(screen.queryByRole("button", { name: en.header.menuAria })).toBeNull();
    expectNoLanguageSwitcher(container);
  });

  describe("scrolling (#362): the /ideas header scrolls away, the rest stay pinned", () => {
    // jsdom has no layout, so the positioning scheme IS the observable: an
    // absolute header travels up with the page, a fixed one stays put — and
    // only a fixed one ever turns into the frosted bar.
    const scrollTo = (y: number) => {
      Object.defineProperty(window, "scrollY", { value: y, configurable: true });
      fireEvent.scroll(window);
    };
    afterEach(() => scrollTo(0));

    it("/ideas: absolute, not fixed, and no frosted bar after a scroll", () => {
      nav.pathname = "/ideas";
      scrollTo(400);
      render(<SiteHeader authSlot={null} paymentsEnabled />);

      const header = screen.getByRole("banner");
      expect(header.classList.contains("absolute")).toBe(true);
      expect(header.classList.contains("fixed")).toBe(false);
      expect(header.classList.contains("bg-espresso/85")).toBe(false);
      expect(header.classList.contains("backdrop-blur-xl")).toBe(false);
      // Still the top-of-page scrim, so the logo reads over the hero.
      expect(header.classList.contains("bg-gradient-to-b")).toBe(true);
    });

    it("/about: fixed, and frosted once the page scrolls", () => {
      nav.pathname = "/about";
      render(<SiteHeader authSlot={null} paymentsEnabled />);
      const header = screen.getByRole("banner");
      expect(header.classList.contains("fixed")).toBe(true);
      expect(header.classList.contains("bg-espresso/85")).toBe(false);

      scrollTo(400);
      expect(header.classList.contains("fixed")).toBe(true);
      expect(header.classList.contains("bg-espresso/85")).toBe(true);
      expect(header.classList.contains("backdrop-blur-xl")).toBe(true);
    });
  });

  it("/about keeps the full header — without a language switcher (#445)", () => {
    nav.pathname = "/about";
    const { container } = render(
      <SiteHeader
        authSlot={<button type="button">account-slot</button>}
        paymentsEnabled
      />,
    );

    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "account-slot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.header.menuAria })).toBeTruthy();
    expectNoLanguageSwitcher(container);
  });
});
