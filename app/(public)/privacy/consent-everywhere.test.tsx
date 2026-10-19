import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

// #466 — the cookie banner is for every country. Until then the code asked
// for marketing consent only in the EU/EEA, the UK and Switzerland and turned
// it on by default elsewhere (#342 wrote that into /privacy §3, #443 into §2
// and §4). proxy.ts writes no consent default any more and lib/cookie-consent
// has no country list, so every place the policy names the marketing switch —
// §2 «Marketing-attribution data» and «Story ideas», the §3 basis, the §4
// rows of the tools behind it — and /cookies §3 now say the same thing:
// consent through the banner, wherever you are, switched off from the
// footer's «Cookie preferences» (named by the label the footer really
// renders). The code side is pinned in proxy.test.ts.
//
// Real getDict/getLocale and LegalLink: only the request is faked, as in
// ./app-section.test.tsx.

const h = vi.hoisted(() => ({ headers: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k) ?? null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

import { en } from "@/lib/i18n/dictionaries";
import CookiesPage from "../cookies/page";
import PrivacyPage from "./page";

async function render(Page: () => Promise<React.ReactElement>): Promise<string> {
  h.headers = new Map();
  const { prelude } = await prerender(await Page());
  return new Response(prelude).text();
}

// One <section> by id, up to the next one.
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return "";
  const end = html.indexOf("<section", start + 1);
  return html.slice(start, end < 0 ? undefined : end);
}

// HTML as plain text: tags dropped, line breaks from the JSX collapsed.
const text = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ");

// The <li> of a section that contains `marker`, as plain text.
function item(sectionHtml: string, marker: string): string {
  const li = sectionHtml
    .split("<li")
    .slice(1)
    .find((chunk) => chunk.includes(marker));
  if (!li) return "";
  return text(li.slice(li.indexOf(">") + 1));
}

const FOOTER = `“${en.footer.cookiePreferences}” in the footer`;

// What the geo rule used to put in these passages — none of it may survive.
const GEO = [
  "EU/EEA",
  "EU, EEA",
  "Switzerland",
  "Elsewhere",
  "elsewhere",
  "by default",
  "where the law allows",
];

function expectNoGeoRule(passage: string, label: string) {
  for (const phrase of GEO) expect(passage, `${label}: ${phrase}`).not.toContain(phrase);
}

// Every tool the marketing switch turns on (#420: the §3 item names them all
// before its basis sentence, and Mux Data nowhere else in §3).
const TOOLS = [
  "Meta Pixel",
  "Meta Conversions API",
  "PostHog",
  "Google Analytics",
  "ChatGPT Ads measurement pixel",
  "Mux Data",
];

// The §4 rows whose processing the marketing switch turns on.
const GATED_ROWS = [
  "Meta Platforms Ireland Ltd",
  "PostHog Inc.",
  "Google Analytics 4",
  "Mux Inc.",
];

describe("/privacy — marketing consent through the banner, for everyone (#466)", () => {
  it("§3: consent is the basis wherever you are — the tools first, then the banner and the footer control", async () => {
    const marketing = item(section(await render(PrivacyPage), "purposes"), "attribution_first");
    expect(marketing).not.toBe("");

    const basisAt = marketing.indexOf("Lawful basis: consent");
    expect(basisAt).toBeGreaterThan(-1);
    for (const tool of TOOLS) {
      const at = marketing.indexOf(tool);
      expect(at, tool).toBeGreaterThan(-1);
      expect(at, tool).toBeLessThan(basisAt);
    }
    const basis = marketing.slice(basisAt);
    expect(basis).toContain("wherever you are");
    expect(basis).toContain("cookie banner");
    expect(basis).toContain(FOOTER);
    expectNoGeoRule(marketing, "§3");
  });

  it("§3 files Mux Data once, under that item — not under the legitimate-interests one", async () => {
    const purposes = section(await render(PrivacyPage), "purposes");
    expect(item(purposes, "To improve the service")).not.toContain("Mux");
    const withMux = purposes
      .split("<li")
      .slice(1)
      .filter((li) => li.includes("Mux Data"));
    expect(withMux).toHaveLength(1);
    expect(withMux[0]).toContain("attribution_first");
  });

  it("§2 «Marketing-attribution data» names every tool, then the banner for everyone and the footer control", async () => {
    const attribution = item(section(await render(PrivacyPage), "data"), "Marketing-attribution data");
    expect(attribution).not.toBe("");

    const ruleAt = attribution.indexOf("Wherever you are");
    expect(ruleAt).toBeGreaterThan(-1);
    for (const tool of TOOLS) {
      const at = attribution.indexOf(tool);
      expect(at, tool).toBeGreaterThan(-1);
      expect(at, tool).toBeLessThan(ruleAt);
    }
    expect(attribution).toContain("only after you accept them in the cookie banner");
    expect(attribution).toContain(FOOTER);
    expectNoGeoRule(attribution, "§2 attribution");
  });

  it("§2 «Story ideas» keeps the campaign only under that consent, in the same words", async () => {
    const ideas = item(section(await render(PrivacyPage), "data"), "Story ideas");
    expect(ideas).not.toBe("");
    expect(ideas).toContain("only while marketing cookies are on");
    expect(ideas).toContain("after you accept them in the cookie banner");
    expect(ideas).toContain(FOOTER);
    expectNoGeoRule(ideas, "§2 ideas");
  });

  it("§4: the Meta, PostHog, Google Analytics and Mux rows — and any row naming the switch — say the banner, not a region", async () => {
    const sharing = section(await render(PrivacyPage), "sharing");
    for (const marker of GATED_ROWS) {
      const row = item(sharing, marker);
      expect(row, marker).toContain("marketing cookies");
      expect(row, marker).toContain("after you accept them in the cookie banner");
      expect(row, marker).toContain(FOOTER);
    }
    expect(item(sharing, "Mux Inc.")).toContain("Mux Data");

    const switchRows = sharing
      .split("<li")
      .slice(1)
      .map((li) => item(`<li${li}`, "marketing cookies"))
      .filter((row) => row !== "");
    expect(switchRows.length).toBeGreaterThanOrEqual(GATED_ROWS.length);
    for (const row of switchRows) expectNoGeoRule(row, "§4");
  });
});

describe("/cookies §3 — the banner for everyone (#466)", () => {
  it("sets marketing cookies only after «Accept all», wherever you are, with the footer control to withdraw", async () => {
    const manage = text(section(await render(CookiesPage), "manage"));
    expect(manage).not.toBe("");
    expect(manage).toContain("Wherever you are, marketing cookies are set only after you accept them in the banner");
    expect(manage).toContain("turn them off at any time");
    expect(manage).toContain(`“${en.footer.cookiePreferences}” link in the site footer`);
    expectNoGeoRule(manage, "/cookies §3");
  });
});
