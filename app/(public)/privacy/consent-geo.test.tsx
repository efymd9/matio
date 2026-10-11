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
