/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { isNextLink, prefetchOf } from "@/tools/test/next-link-probe";

// `prefetch={false}` leaves no trace in the HTML — the probe records it.
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

// Mutable so a test can put the header on another route (#297); reset to
// "/" after each test.
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

// The real module pulls the locale server action in; the header only reads
// (and, on the /ideas toggle, asks for a switch — recorded here).
const locale = vi.hoisted(() => ({ setLocale: vi.fn() }));
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return {
    useT: () => en,
    useLocale: () => "en",
    useSetLocale: () => ({ setLocale: locale.setLocale, isPending: false }),
  };
});

import { SiteHeader } from "./site-header";

afterEach(() => {
  cleanup();
  nav.pathname = "/";
  locale.setLocale.mockReset();
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
  // header is the logo and an inline EN · ES toggle — nothing else.

  it.each(["/ideas", "/es/ideas"])(
    "%s: logo + language group, no nav, no account slot, no menu",
    (pathname) => {
      nav.pathname = pathname;
      render(
        <SiteHeader
          authSlot={<button type="button">account-slot</button>}
          paymentsEnabled
        />,
      );

      expect(screen.getByRole("link", { name: en.header.home })).toBeTruthy();
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.queryByRole("button", { name: "account-slot" })).toBeNull();
      expect(screen.queryByRole("button", { name: en.header.menuAria })).toBeNull();
      expect(screen.queryByRole("button", { name: en.language.switchAria })).toBeNull();

      const group = screen.getByRole("group", { name: en.language.label });
      const links = within(group).getAllByRole("link");
      expect(links.map((a) => a.getAttribute("href"))).toEqual(["/ideas", "/es/ideas"]);
      expect(links.map((a) => a.getAttribute("hreflang"))).toEqual(["en", "es"]);
      // The (mocked) site locale is English — that link is the current one.
      expect(links[0].getAttribute("aria-current")).toBe("true");
      expect(links[1].getAttribute("aria-current")).toBeNull();
    },
  );

  it("a click on ES writes the locale first (no bare navigation to be 307'd back)", () => {
    nav.pathname = "/ideas";
    render(<SiteHeader authSlot={null} paymentsEnabled />);

    const es = within(screen.getByRole("group", { name: en.language.label })).getByRole(
      "link",
      { name: "ES" },
    );
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    es.dispatchEvent(click);

    expect(locale.setLocale).toHaveBeenCalledWith("es");
    expect(click.defaultPrevented).toBe(true);
  });

  it("/about keeps the full header", () => {
    nav.pathname = "/about";
    render(
      <SiteHeader
        authSlot={<button type="button">account-slot</button>}
        paymentsEnabled
      />,
    );

    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "account-slot" })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.header.menuAria })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.language.switchAria })).toBeTruthy();
    expect(screen.queryByRole("group", { name: en.language.label })).toBeNull();
  });
});
