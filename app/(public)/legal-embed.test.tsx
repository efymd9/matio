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

// Withdrawing the Spanish translation (#445) is not a new edition of a
// document whose English text did not change by a word: /terms and /privacy
// keep the dates they had, /cookies moves because its table lost the `locale`
// row. /terms is tied to the wallet checkbox's TOS_VERSION (#214) — a stored
// acceptance has to name the edition the page shows.
describe("«Last updated»", () => {
  it("/terms shows the TOS_VERSION edition", async () => {
    const edition = new Date(`${TOS_VERSION}T00:00:00Z`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(edition).toBe("September 9, 2026");
    expect(await render(TermsPage)).toContain(`Last updated: ${edition}`);
  });

  it("/privacy keeps its edition, /cookies has the #445 one", async () => {
    expect(await render(PrivacyPage)).toContain("Last updated: October 11, 2026");
    expect(await render(CookiesPage)).toContain("Last updated: October 12, 2026");
  });
});
