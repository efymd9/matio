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
import { en, es } from "@/lib/i18n/dictionaries";
import PrivacyPage from "./page";

async function render(locale: "en" | "es"): Promise<string> {
  h.headers = new Map([["x-matio-locale", locale]]);
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
  {
    locale: "es",
    purposes: "finalidades",
    collect: "datos",
    ideasMarker: "Ideas de historias",
    regions: "UE/EEE, el Reino Unido y Suiza",
    onByDefault: "en el resto del mundo están activadas por defecto",
    footerLabel: `«${es.footer.cookiePreferences}», en el pie de página`,
    basis: "consentimiento",
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
      const html = await render(c.locale);
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
      const html = await render(c.locale);
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
  {
    locale: "es",
    purposes: "finalidades",
    improveMarker: "Para mejorar el servicio",
    regions: "UE/EEE, el Reino Unido y Suiza",
    tools: [
      "Meta Pixel",
      "API de Conversiones de Meta",
      "PostHog",
      "Google Analytics",
      "píxel de medición de ChatGPT Ads",
      "Mux Data",
    ],
  },
] as const;

describe("/privacy §3 — every consent-gated measurement tool sits under the consent item (#420)", () => {
  it.each(TOOL_CASES)(
    "($locale) names Mux Data and the ChatGPT Ads pixel in the consent item, before its basis sentence",
    async (c) => {
      const html = await render(c.locale);
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
      const purposes = section(await render(c.locale), c.purposes);
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
