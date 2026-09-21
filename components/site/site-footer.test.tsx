/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { en } from "@/lib/i18n/dictionaries";
import { isNextLink, prefetchOf } from "@/tools/test/next-link-probe";

// next/link prefetches whatever is on screen, and the footer is on screen on
// every public page. Two of its targets must not be prefetched (#259), and
// neither fact shows in the HTML — hence the probe (see its header).
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// The real module pulls the locale server action in; the footer only reads.
vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return {
    useT: () => en,
    useLocale: () => "en",
    useSetLocale: () => ({ setLocale: () => undefined, isPending: false }),
  };
});

import { SiteFooter } from "./site-footer";

afterEach(cleanup);

// jsdom applies no CSS, so BOTH link sets are in the document at once: the
// mobile wrapping row and the tablet/desktop columns. Every assertion below
// therefore covers the two places a link is written.
const links = (name: string) => screen.getAllByRole("link", { name });

describe("SiteFooter — links that must not be prefetched (#259)", () => {
  it.each([
    ["paid mode", true],
    ["free mode", false],
  ])(
    "links to the billing portal with a plain <a>, never next/link — %s",
    (_mode, paymentsEnabled) => {
      // /api/billing-portal is a route handler: a GET creates a Stripe portal
      // session. Through next/link every footer that scrolls into a
      // subscriber's view would create one nobody opens. The link stays in
      // free mode too (legacy subscribers cancel there), so both modes count.
      render(<SiteFooter paymentsEnabled={paymentsEnabled} />);

      const portal = links(en.footer.manage);
      expect(portal).toHaveLength(2);
      for (const a of portal) {
        expect(a.tagName).toBe("A");
        expect(a.getAttribute("href")).toBe("/api/billing-portal");
        expect(isNextLink(a)).toBe(false);
      }
    },
  );

  it("renders the portal link exactly like its next/link siblings", () => {
    // The swap to <a> must be invisible: same element, same classes, inside
    // the same <li> as every other footer link.
    render(<SiteFooter paymentsEnabled />);

    const portal = links(en.footer.manage);
    const about = links(en.footer.about);
    portal.forEach((a, i) => {
      expect(a.className).toBe(about[i].className);
      expect(a.className).not.toBe("");
      expect(a.parentElement?.tagName).toBe("LI");
    });
  });

  it("keeps /subscribe a next/link but switches its prefetch off", () => {
    // A signed-out visitor's /subscribe is a 307 to Clerk's origin; the
    // prefetch fetch cannot follow it (CORS) and lands in Sentry as an
    // unhandled "Failed to fetch". Still a next/link: a signed-in visitor
    // gets client navigation.
    render(<SiteFooter paymentsEnabled />);

    const subscribe = links(en.footer.subscribe);
    expect(subscribe).toHaveLength(2);
    for (const a of subscribe) {
      expect(a.getAttribute("href")).toBe("/subscribe");
      expect(isNextLink(a)).toBe(true);
      expect(prefetchOf(a)).toBe("false");
    }
  });

  it("leaves every other footer link on next/link's default prefetch", () => {
    // The control: the two rules above are exceptions, not a footer-wide
    // switch. An ordinary page keeps the prefetch that makes it feel instant.
    render(<SiteFooter paymentsEnabled />);

    for (const name of [en.footer.about, en.footer.press, en.footer.terms]) {
      for (const a of links(name)) {
        expect(isNextLink(a)).toBe(true);
        expect(prefetchOf(a)).toBe("default");
      }
    }
  });

  it("has no Subscribe link at all while payments are off", () => {
    render(<SiteFooter paymentsEnabled={false} />);

    expect(screen.queryAllByRole("link", { name: en.footer.subscribe })).toEqual(
      [],
    );
  });
});
