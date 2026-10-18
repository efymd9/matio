import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #310 — /terms, /privacy and /cookies as the app opens them (`?embed=app`,
// which proxy.ts turns into the x-matio-embed request header). The embed
// variant is a second URL of the same document: out of the index, canonical
// on the normal page. Its only ways out are the links to the other two
// documents, and those stay inside the embed — never «home», which is the
// full site. The normal pages stay exactly as they were. Since #445 every
// one of them is English, with no Spanish twin to link or annotate.
//
// Real getDict and real LegalLink: only the request is faked.

const h = vi.hoisted(() => ({ headers: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k) ?? null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => true }));

import CookiesPage, { generateMetadata as cookiesMetadata } from "./cookies/page";
import PrivacyPage, { generateMetadata as privacyMetadata } from "./privacy/page";
import TermsPage, { generateMetadata as termsMetadata } from "./terms/page";
import { TOS_VERSION } from "@/lib/wallet-checkout";

const PAGES = [
  { path: "/terms", Page: TermsPage, metadata: termsMetadata, others: ["/privacy", "/cookies"] },
  { path: "/privacy", Page: PrivacyPage, metadata: privacyMetadata, others: ["/terms", "/cookies"] },
  { path: "/cookies", Page: CookiesPage, metadata: cookiesMetadata, others: ["/privacy", "/terms"] },
] as const;

function request(opts: { embed?: boolean }) {
  h.headers = new Map();
  if (opts.embed) h.headers.set("x-matio-embed", "app");
}

async function render(Page: () => Promise<React.JSX.Element>): Promise<string> {
  const { prelude } = await prerender(await Page());
  return new Response(prelude).text();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
}

beforeEach(() => request({}));

describe.each(PAGES)("$path", ({ path, Page, metadata, others }) => {
  it("normal page: indexed, links home and to the bare documents", async () => {
    request({});

    const meta = await metadata();
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(`https://matio.tv${path}`);

    const links = hrefs(await render(Page));
    expect(links).toContain("/");
    for (const other of others) expect(links).toContain(other);
    expect(links.some((l) => l.includes("embed="))).toBe(false);
  });

  it("embed: noindex, canonical on the normal URL, no way home", async () => {
    request({ embed: true });

    const meta = await metadata();
    expect(meta.robots).toMatchObject({ index: false });
    expect(meta.alternates?.canonical).toBe(`https://matio.tv${path}`);

    const links = hrefs(await render(Page));
    expect(links).not.toContain("/");
    for (const other of others) {
      expect(links).toContain(`${other}?embed=app`);
      expect(links).not.toContain(other);
    }
    // Every internal link stays inside the embed.
    for (const link of links.filter((l) => l.startsWith("/"))) {
      expect(link).toMatch(/\?embed=app$/);
    }
  });

  it("English only (#445): a stray x-matio-locale=es changes nothing — no /es link, no hreflang", async () => {
    request({ embed: true });
    h.headers.set("x-matio-locale", "es");

    const meta = await metadata();
    expect(meta.alternates).toEqual({ canonical: `https://matio.tv${path}` });

    const html = await render(Page);
    for (const link of hrefs(html)) expect(link).not.toMatch(/^\/es(?:\/|$|\?)/);
    for (const other of others) expect(hrefs(html)).toContain(`${other}?embed=app`);
  });
});

// Withdrawing the Spanish translation (#445) was not a new edition of a
// document whose English text did not change by a word. Removing the
// 60-second preview (#462) is one for all three: /terms §4, the /cookies
// `trial_session` row and /privacy §2 + §11 describe the free-episode record
// instead. /terms is tied to the wallet checkbox's TOS_VERSION (#214) — a
// stored acceptance has to name the edition the page shows.
describe("«Last updated»", () => {
  it("/terms shows the TOS_VERSION edition", async () => {
    const edition = new Date(`${TOS_VERSION}T00:00:00Z`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(edition).toBe("October 18, 2026");
    expect(await render(TermsPage)).toContain(`Last updated: ${edition}`);
  });

  it("/privacy and /cookies have the #462 edition", async () => {
    expect(await render(PrivacyPage)).toContain("Last updated: October 18, 2026");
    expect(await render(CookiesPage)).toContain("Last updated: October 18, 2026");
  });
});

// #462 — the preview is gone from the legal pages: none of them may still
// promise one, and /terms §4 says what replaced it.
describe("no 60-second preview", () => {
  it("is promised by /terms, /privacy or /cookies", async () => {
    for (const Page of [TermsPage, PrivacyPage, CookiesPage]) {
      const html = (await render(Page)).replace(/\s+/g, " ");
      expect(html).not.toMatch(/60-second|free preview|preview expires/i);
    }
  });

  it("/terms §4 is about episode access, without numbers for the anonymous limit", async () => {
    const html = (await render(TermsPage)).replace(/\s+/g, " ");
    expect(html).toContain("4. Episode access");
    expect(html).toContain("does not offer a time-limited preview");
    expect(html).toContain("short, muted teaser that plays on our home page");
    expect(html).toContain("never stops a free episode from playing");
    expect(html).not.toContain("three per network per hour");
  });
});
