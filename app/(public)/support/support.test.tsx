import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

// #485 — /support, the Support URL of the App Store listing (#486). The text
// is a DRAFT (counsel, #168); what these cases pin is what a reviewer and a
// viewer must find there — who runs Matio, the one contact address, the
// app's own «Delete account» path in the app's own words — and what the page
// must never carry: a price or a way to buy (App Store 3.1.1 — the app sells
// nothing, and the listing points here).
//
// Real getDict: only next/link is swapped for the probe, to read hrefs.

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

import { isAppEmbedRequest } from "@/lib/app-embed";
import { appEn } from "@/lib/i18n/app-dictionaries";
import { en } from "@/lib/i18n/dictionaries";
import SupportPage, { generateMetadata } from "./page";

async function render(): Promise<string> {
  const { prelude } = await prerender(await SupportPage());
  return new Response(prelude).text();
}

/** Text with tags stripped, entities decoded, whitespace collapsed. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replace(/<!-- -->/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ");

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));

describe("/support (#485)", () => {
  it("is an indexed page at its bare canonical, titled Support", async () => {
    const meta = await generateMetadata();
    expect(meta.title).toBe(en.legal.supportTitle);
    expect(meta.description).toBe(en.legal.supportDescription);
    expect(meta.alternates).toEqual({ canonical: "https://matio.tv/support" });
    // No robots override: the root layout's index/follow (with its googleBot
    // snippet options) applies, and no noindex embed variant exists.
    expect(meta.robots).toBeUndefined();
  });

  it("says who runs Matio and how to reach us", async () => {
    const html = await render();
    const t = text(html);
    expect(t).toContain("DEEP ORDINARY LTD");
    expect(t).toContain("17381666");
    expect(t).toContain("66 Paul Street, London EC2A 4NA");
    expect(t).toContain("maksym@matio.tv");
    expect(hrefs(html)).toContain("mailto:maksym@matio.tv");
    // A guide, not an SLA — and the 30 days /privacy §7 already promises.
    expect(t).toContain("We aim to reply within a few working days");
    expect(t).toContain("answered within 30 days");
  });

  it("explains the email code and what to do when it does not arrive", async () => {
    const t = text(await render());
    expect(t).toContain("one-time code");
    expect(t).toContain("spam or junk folder");
    expect(t).toContain("Wait a minute, then ask for a new code");
    // The app's own button label, read from the app's dictionary.
    expect(t).toContain(`“${appEn.signIn.resend}” in the app`);
  });

  it("gives the app's «Delete account» path in the app's own words", async () => {
    const t = text(await render());
    expect(t).toContain(`open the ${appEn.tabs.account} tab and tap ${appEn.account.deleteAccount}`);
    expect(t).toContain("The app asks you twice");
    // The same three things the first confirmation says are erased, and the
    // same subscription consequence (lib/i18n/app-dictionaries.ts).
    for (const fact of ["your account", "your watch progress", "your new-episode reminders"]) {
      expect(appEn.account.deleteConfirmBody.toLowerCase()).toContain(fact);
      expect(t).toContain(fact);
    }
    expect(appEn.account.deleteConfirmBody).toContain("cancelled at the end of the current billing period");
    expect(t).toContain("cancelled at the end of the current billing period");
    expect(appEn.account.deleteFinalTitle).toBe("This can't be undone");
    expect(t).toContain("this can’t be undone");
  });

  it("sends the website's deletion to the mailbox while Clerk's webhook misses user.deleted (#172)", async () => {
    const t = text(await render());
    expect(t).toContain("On the website: write to maksym@matio.tv");
    // Not Clerk's own menu button: it would leave our data behind (#172).
    expect(t).not.toContain("Manage account");
    expect(t).not.toContain("Security");
  });

  it("names no price and links to no purchase (App Store 3.1.1)", async () => {
    const html = await render();
    const t = text(html);
    expect(t).not.toContain("$25");
    expect(t).not.toMatch(/[$€£]\s?\d/);
    expect(t).not.toMatch(/\bprice\b|\/month|per month/i);
    for (const href of hrefs(html)) {
      expect(href).not.toMatch(/^\/(subscribe|checkout)(?:[/?]|$)/);
      expect(href).not.toContain("billing-portal");
    }
    expect(html).not.toContain("/subscribe");
    expect(html).not.toContain("/checkout");
    expect(t).toContain("Nothing is sold in the Matio app");
    expect(t).toContain(en.footer.manage);
  });

  it("links the three policies and home", async () => {
    const links = hrefs(await render());
    for (const path of ["/privacy", "/terms", "/cookies", "/"]) expect(links).toContain(path);
    expect(links.some((l) => l.includes("embed="))).toBe(false);
  });

  it("has no ?embed=app variant — the app opens only the three legal documents", () => {
    // Decided in #485: nothing in the app opens /support (its support entry
    // is the mailto in /v1/config), so proxy.ts never strips its chrome.
    const embed = new URLSearchParams({ embed: "app" });
    expect(isAppEmbedRequest("/support", embed)).toBe(false);
    expect(isAppEmbedRequest("/privacy", embed)).toBe(true);
  });
});
