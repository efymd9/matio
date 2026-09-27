import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #310 — /terms, /privacy and /cookies as the app opens them (`?embed=app`,
// which proxy.ts turns into the x-matio-embed request header, together with
// the URL's language in x-matio-locale). The embed variant is a second URL of
// the same document: out of the index, canonical on the normal page. Its only
// ways out are the links to the other two documents, and those stay inside
// the embed and inside the language — never «home», which is the full site.
// The normal pages stay exactly as they were.
//
// Real getDict/getLocale and real LegalLink: only the request is faked.

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

const PAGES = [
  { path: "/terms", Page: TermsPage, metadata: termsMetadata, others: ["/privacy", "/cookies"] },
  { path: "/privacy", Page: PrivacyPage, metadata: privacyMetadata, others: ["/terms", "/cookies"] },
  { path: "/cookies", Page: CookiesPage, metadata: cookiesMetadata, others: ["/privacy", "/terms"] },
] as const;

function request(opts: { embed?: boolean; locale?: "en" | "es" }) {
  h.headers = new Map();
  if (opts.embed) h.headers.set("x-matio-embed", "app");
  if (opts.locale) h.headers.set("x-matio-locale", opts.locale);
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
    request({ locale: "en" });

    const meta = await metadata();
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.alternates?.canonical).toBe(`https://matio.tv${path}`);

    const links = hrefs(await render(Page));
    expect(links).toContain("/");
    for (const other of others) expect(links).toContain(other);
    expect(links.some((l) => l.includes("embed="))).toBe(false);
  });

  it("embed (en): noindex, canonical on the normal URL, no way home", async () => {
    request({ embed: true, locale: "en" });

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

  it("embed (es): the cross-links keep the reader's language", async () => {
    request({ embed: true, locale: "es" });

    const meta = await metadata();
    expect(meta.robots).toMatchObject({ index: false });
    expect(meta.alternates?.canonical).toBe(`https://matio.tv/es${path}`);

    const links = hrefs(await render(Page));
    for (const other of others) expect(links).toContain(`/es${other}?embed=app`);
    expect(links).not.toContain("/");
  });
});
