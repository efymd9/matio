import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

// #342 — /privacy §3 states the basis for marketing measurement (the
// attribution cookies, Meta Pixel / CAPI, PostHog, GA4). The code asks for
// consent only in the EU/EEA, the UK and Switzerland and turns it on by
// default elsewhere, with an opt-out behind the footer's «Cookie preferences»
// (lib/cookie-consent.ts:marketingConsentRequired, read by proxy.ts). The
// policy once promised the banner to everyone; these cases pin that §3 now
// says what the code does, names the footer control by the label the footer
// really renders, and agrees with the §2 ideas item, which said it first.
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

import { marketingConsentRequired } from "@/lib/cookie-consent";
import { en } from "@/lib/i18n/dictionaries";
import PrivacyPage from "./page";

async function render(): Promise<string> {
  h.headers = new Map();
  const { prelude } = await prerender(await PrivacyPage());
  return new Response(prelude).text();
}

// One <section> by id, up to the next one.
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return "";
  const end = html.indexOf("<section", start + 1);
  return html.slice(start, end < 0 ? undefined : end);
}

// The <li> of a section that contains `marker`, as plain text: tags dropped,
// line breaks from the JSX source collapsed to single spaces.
function item(sectionHtml: string, marker: string): string {
  const li = sectionHtml
    .split("<li")
    .slice(1)
    .find((chunk) => chunk.includes(marker));
  if (!li) return "";
  return li
    .slice(li.indexOf(">") + 1)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ");
}

const CASES = [
  {
    locale: "en",
    purposes: "purposes",
    collect: "data",
    ideasMarker: "Story ideas",
    regions: "EU/EEA, the UK and Switzerland",
    onByDefault: "elsewhere they are on by default",
    footerLabel: `“${en.footer.cookiePreferences}” in the footer`,
    basis: "consent",
  },
] as const;

describe("/privacy §3 — marketing measurement and the geo-aware consent default (#342)", () => {
  it("rests on the code's rule: the banner in the EU/EEA, UK and CH, default-on elsewhere, unknown country as the EU", () => {
    for (const c of ["ES", "DE", "IE", "NO", "IS", "LI", "GB", "CH"]) {
      expect(marketingConsentRequired(c), c).toBe(true);
    }
    for (const c of ["US", "MX", "BR", "AR", "CO"]) {
      expect(marketingConsentRequired(c), c).toBe(false);
    }
    expect(marketingConsentRequired(null)).toBe(true);
  });

  it.each(CASES)(
    "($locale) asks for consent only where the banner does, and points everyone else to the footer opt-out",
    async (c) => {
      const html = await render();
      const marketing = item(section(html, c.purposes), "attribution_first");
      expect(marketing).not.toBe("");

      // Consent is the basis named for the banner regions — and named only
      // after them, never as a promise to every visitor.
      const regionsAt = marketing.indexOf(c.regions);
      expect(regionsAt).toBeGreaterThan(-1);
      expect(marketing.indexOf(c.basis)).toBeGreaterThan(regionsAt);
      expect(marketing.indexOf("banner")).toBeGreaterThan(regionsAt);

      // Elsewhere: on by default, switched off from the control the footer
      // really shows under that label.
      expect(marketing.toLowerCase()).toContain(c.onByDefault.toLowerCase());
      expect(marketing).toContain(c.footerLabel);
    },
  );

  it.each(CASES)(
    "($locale) says the same as the §2 ideas item: the same regions, the same footer control",
    async (c) => {
      const html = await render();
      const ideas = item(section(html, c.collect), c.ideasMarker);
      const marketing = item(section(html, c.purposes), "attribution_first");
      expect(ideas).not.toBe("");

      for (const phrase of [c.regions, c.footerLabel]) {
        expect(ideas).toContain(phrase);
        expect(marketing).toContain(phrase);
      }
    },
  );
});

// #420 — the same §3 item is where every tool the marketing-consent gate
// switches on has to be named, because its basis sentence covers "these".
// Mux Data is one of them (both players pass disableTracking/disableCookies
// and no envKey without consent — lib/use-marketing-consent.ts, pinned by
// components/watch/player.test.tsx and components/site/hero-banner.test.tsx),
// and so is the ChatGPT Ads pixel (components/site/openai-pixel.tsx); /cookies
// §2 names both under that consent. §3 once filed Mux Data under the
// legitimate-interests "improve the service" item and left the pixel out.
const TOOL_CASES = [
  {
    locale: "en",
    purposes: "purposes",
    improveMarker: "To improve the service",
    regions: "EU/EEA, the UK and Switzerland",
    tools: [
      "Meta Pixel",
      "Meta Conversions API",
      "PostHog",
      "Google Analytics",
      "ChatGPT Ads measurement pixel",
      "Mux Data",
    ],
  },
] as const;

describe("/privacy §3 — every consent-gated measurement tool sits under the consent item (#420)", () => {
  it.each(TOOL_CASES)(
    "($locale) names Mux Data and the ChatGPT Ads pixel in the consent item, before its basis sentence",
    async (c) => {
      const html = await render();
      const marketing = item(section(html, c.purposes), "attribution_first");
      const basisAt = marketing.indexOf(c.regions);
      expect(basisAt).toBeGreaterThan(-1);
      for (const tool of c.tools) {
        const at = marketing.indexOf(tool);
        expect(at, tool).toBeGreaterThan(-1);
        expect(at, tool).toBeLessThan(basisAt);
      }
    },
  );

  it.each(TOOL_CASES)(
    "($locale) no longer files Mux Data under the legitimate-interests item — §3 names it once",
    async (c) => {
      const purposes = section(await render(), c.purposes);
      const improve = item(purposes, c.improveMarker);
      expect(improve).not.toBe("");
      expect(improve).not.toContain("Mux");

      const withMux = purposes
        .split("<li")
        .slice(1)
        .filter((li) => li.includes("Mux Data"));
      expect(withMux).toHaveLength(1);
      expect(withMux[0]).toContain("attribution_first");
    },
  );
});

// #443 — §2 «Marketing-attribution data» and the §4 rows of the tools behind
// that consent are the other places the policy names it. They once said
// «if / after you accept marketing cookies» to every visitor, while the code
// asks only in the EU/EEA, UK and CH and turns the switch on by default
// elsewhere (lib/cookie-consent.ts:marketingConsentRequired, proxy.ts
// autoGrant) — and §2 did not name the ChatGPT Ads pixel or Mux Data, which
// read the same cookie_consent.marketing (components/site/openai-pixel.tsx,
// lib/use-marketing-consent.ts). They now carry the §3 rule and the §3 list.
const ELSEWHERE_CASES = [
  {
    ...CASES[0],
    tools: TOOL_CASES[0].tools,
    sharing: "sharing",
    attributionMarker: "Marketing-attribution data",
    defaultWord: "by default",
    consentPhrase: "marketing cookies",
    oldPhrases: [
      "If you accept marketing cookies",
      "after you accept marketing cookies",
    ],
  },
] as const;

// The §4 rows whose processing the marketing switch turns on: Meta (Pixel +
// CAPI), PostHog, Google Analytics — and Mux, for Mux Data.
const GATED_ROWS = [
  "Meta Platforms Ireland Ltd",
  "PostHog Inc.",
  "Google Analytics 4",
  "Mux Inc.",
] as const;

describe("/privacy §2 and §4 — the same geo rule and the same tools as §3 (#443)", () => {
  it.each(ELSEWHERE_CASES)(
    "($locale) §2 names every tool §3 names, then the banner regions and the footer opt-out — no «if you accept» for everyone",
    async (c) => {
      const html = await render();
      const attribution = item(section(html, c.collect), c.attributionMarker);
      expect(attribution).not.toBe("");
      for (const old of c.oldPhrases) expect(attribution).not.toContain(old);

      const regionsAt = attribution.indexOf(c.regions);
      expect(regionsAt).toBeGreaterThan(-1);
      expect(attribution.toLowerCase()).toContain(c.onByDefault.toLowerCase());
      expect(attribution).toContain(c.footerLabel);
      for (const tool of c.tools) {
        const at = attribution.indexOf(tool);
        expect(at, tool).toBeGreaterThan(-1);
        expect(at, tool).toBeLessThan(regionsAt);
      }
    },
  );

  it.each(ELSEWHERE_CASES)(
    "($locale) §4: the Meta, PostHog, Google Analytics and Mux rows — and any row that names the consent — carry the geo rule",
    async (c) => {
      const sharing = section(await render(), c.sharing);
      for (const marker of GATED_ROWS) {
        expect(item(sharing, marker), marker).toContain(c.consentPhrase);
      }
      expect(item(sharing, "Mux Inc.")).toContain("Mux Data");

      const consentRows = sharing
        .split("<li")
        .slice(1)
        .map((li) => item(`<li${li}`, c.consentPhrase))
        .filter((row) => row !== "");
      expect(consentRows.length).toBeGreaterThanOrEqual(GATED_ROWS.length);
      for (const row of consentRows) {
        for (const old of c.oldPhrases) expect(row).not.toContain(old);
        expect(row).toContain(c.regions);
        expect(row).toContain(c.defaultWord);
        expect(row).toContain(c.footerLabel);
      }
    },
  );
});
