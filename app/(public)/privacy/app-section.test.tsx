import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #312 — /privacy §11 «Our mobile app» (App Store 5.1.1(i), art. 13): the
// notice for what the app collects, and in the `?embed=app` variant the app
// itself opens (#310) — the same page component, so the app's readers get the
// same section. The section is DRAFT legal copy; what these cases pin is that
// it is there and that its numbers are the code's: the retention windows are
// read from lib/retention.ts, and §6 — which that module cites — keeps its
// number. English only since #445: the Spanish twin of the page is gone, and
// `otherHeading` proves it never renders.
//
// Real getDict and LegalLink: only the request is faked, as in
// ../legal-embed.test.tsx.

const h = vi.hoisted(() => ({ headers: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k) ?? null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));
// lib/retention.ts is read for its policy list only; nothing runs.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: () => undefined }));

import { RETENTION_POLICIES } from "@/lib/retention";
import PrivacyPage from "./page";

function request(opts: { embed?: boolean }) {
  h.headers = new Map();
  if (opts.embed) h.headers.set("x-matio-embed", "app");
}

async function render(): Promise<string> {
  const { prelude } = await prerender(await PrivacyPage());
  return new Response(prelude).text();
}

// The section headings, in page order, with entities decoded.
function headings(html: string): string[] {
  return [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) =>
    m[1].replaceAll("&amp;", "&").replaceAll("&#x27;", "'"),
  );
}

// The app section's own markup: from its <section> to the next one.
function appSection(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return "";
  const end = html.indexOf("<section", start + 1);
  return html.slice(start, end < 0 ? undefined : end);
}

const trialWindowDays = (() => {
  const policy = RETENTION_POLICIES.find((p) => p.name === "trial_sessions");
  if (!policy || !("days" in policy.window)) throw new Error("no trial_sessions day window");
  return policy.window.days;
})();

const watchDaysWindowMonths = (() => {
  const policy = RETENTION_POLICIES.find((p) => p.name === "watch_days");
  if (!policy || !("months" in policy.window)) throw new Error("no watch_days month window");
  return policy.window.months;
})();

const CASES = [
  {
    locale: "en",
    id: "app",
    heading: "11. Our mobile app",
    otherHeading: "11. Nuestra aplicación móvil",
    contact: "12. Contact",
    retentionHeading: "6. How long we keep it",
    facts: [
      "random identifier (a UUID)",
      "keychain",
      "can keep the identifier after the app is deleted",
      "does not link the identifier, or the records kept",
      "legitimate interests",
      "10-second stretches",
      "hold no identifier",
      `deleted ${trialWindowDays} days after they are created`,
      "within six hours",
      "are not linked to an account",
      "Before 3 October 2026",
      "Clerk",
      "watch progress",
      `the days watched are kept for up to ${watchDaysWindowMonths} months`,
      "Vercel and Neon",
      "Mux",
      "Error reports",
      "Functional Software, Inc.",
      "never a screenshot",
      "Account → Delete account",
      "Payment and tax records",
      "maksym@matio.tv",
    ],
  },
] as const;

beforeEach(() => request({}));

describe.each(CASES)("/privacy ($locale) — the app section", (c) => {
  it.each([
    { variant: "the normal page", embed: false },
    { variant: "the app's embed page", embed: true },
  ])("is in $variant, with its facts", async ({ embed }) => {
    request({ embed });
    const html = await render();

    const titles = headings(html);
    expect(titles).toContain(c.heading);
    expect(titles).not.toContain(c.otherHeading);

    // Line breaks in the JSX source collapse to single spaces in the HTML.
    const section = appSection(html, c.id).replace(/\s+/g, " ");
    expect(section).not.toBe("");
    for (const fact of c.facts) expect(section).toContain(fact);
  });

  it("slots in as §11 before Contact, leaving §1–§10 — and §6, which the retention cron cites — where they were", async () => {
    request({});
    const titles = headings(await render());

    expect(titles.map((t) => Number.parseInt(t, 10))).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(titles[5]).toBe(c.retentionHeading);
    expect(titles[10]).toBe(c.heading);
    expect(titles[11]).toBe(c.contact);
  });
});
