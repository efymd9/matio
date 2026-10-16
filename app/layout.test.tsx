import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #310 — the root layout renders a legal document the app opened
// (`?embed=app`, stamped by proxy.ts as a request header) with NOTHING around
// it: no site header (its Subscribe link is a Stripe purchase outside the App
// Store), no footer, no cookie banner, and none of the tracker loaders. The
// normal page keeps every one of them.
//
// The header and footer are the REAL components (the Subscribe link is theirs
// to render); the banner, the four consent-gated loaders and the visit beacon
// are stand-ins that only say "I was mounted" — each one does its work in an
// effect, which a server render never runs, so a stand-in is the only honest
// way to see whether the layout mounts it at all.

const h = vi.hoisted(() => ({ headers: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k) ?? null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-stub" });
  return { Anton: font, Geist: font, Geist_Mono: font };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/terms" }));
vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => true }));
vi.mock("@/components/site/user-menu", () => ({ UserMenu: () => null }));

function marker(name: string) {
  function Mounted() {
    return <i data-mounted={name} />;
  }
  return Mounted;
}
vi.mock("@/components/site/cookie-banner", () => ({ CookieBanner: marker("cookie-banner") }));
vi.mock("@/components/site/meta-pixel", () => ({ MetaPixel: marker("meta-pixel") }));
vi.mock("@/components/site/posthog-provider", () => ({
  PostHogProvider: marker("posthog"),
}));
vi.mock("@/components/site/google-analytics", () => ({
  GoogleAnalytics: marker("google-analytics"),
}));
vi.mock("@/components/site/openai-pixel", () => ({ OpenAIPixel: marker("openai-pixel") }));
vi.mock("@/components/site/visit-beacon", () => ({ VisitBeacon: marker("visit-beacon") }));

import RootLayout, { generateMetadata } from "./layout";

const LOADERS = [
  "cookie-banner",
  "meta-pixel",
  "posthog",
  "google-analytics",
  "openai-pixel",
  "visit-beacon",
];

async function render(): Promise<string> {
  const tree = await RootLayout({ children: <main>THE DOCUMENT</main> });
  const { prelude } = await prerender(tree);
  return new Response(prelude).text();
}

beforeEach(() => {
  h.headers = new Map();
});

describe("RootLayout — the app's embed variant (#310)", () => {
  it("renders the document and nothing around it", async () => {
    h.headers.set("x-matio-embed", "app");

    const html = await render();

    expect(html).toContain("THE DOCUMENT");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<footer");
    expect(html).not.toContain('href="/subscribe"');
    for (const loader of LOADERS) {
      expect(html).not.toContain(`data-mounted="${loader}"`);
    }
  });

  it("keeps the whole site chrome on the normal page", async () => {
    const html = await render();

    expect(html).toContain("THE DOCUMENT");
    expect(html).toContain("<header");
    expect(html).toContain("<footer");
    // Paid mode: the header's Subscribe link is exactly what the app must
    // never show — and exactly what the web keeps.
    expect(html).toContain('href="/subscribe"');
    for (const loader of LOADERS) {
      expect(html).toContain(`data-mounted="${loader}"`);
    }
  });

  it("ignores any other value of the header", async () => {
    h.headers.set("x-matio-embed", "1");

    const html = await render();

    expect(html).toContain("<header");
    expect(html).toContain('data-mounted="meta-pixel"');
  });
});

// #376, the owner's option (а): /careers loads no Meta Pixel and no GA4 until
// #341 confirms their automatic form-field collection is off. proxy.ts stamps
// the request (x-matio-ad-pixels: off, lib/ad-pixels.ts); the layout drops
// exactly those two loaders and nothing else — the banner (consent), PostHog,
// the ChatGPT Ads pixel and the visit beacon stay. A page without the stamp
// (/ideas, say) keeps all of them.
describe("RootLayout — /careers without the ad pixels (#376)", () => {
  it("/careers: no Meta Pixel and no GA4 loader; every other loader and the chrome stay", async () => {
    h.headers.set("x-matio-ad-pixels", "off");

    const html = await render();

    expect(html).not.toContain('data-mounted="meta-pixel"');
    expect(html).not.toContain('data-mounted="google-analytics"');
    for (const loader of ["cookie-banner", "posthog", "openai-pixel", "visit-beacon"]) {
      expect(html).toContain(`data-mounted="${loader}"`);
    }
    expect(html).toContain("<header");
    expect(html).toContain("<footer");
  });

  it("a neighbour page (/ideas — no stamp) mounts both of them, like every other page", async () => {
    const html = await render();

    expect(html).toContain('data-mounted="meta-pixel"');
    expect(html).toContain('data-mounted="google-analytics"');
  });

  it("only the exact value switches them off", async () => {
    h.headers.set("x-matio-ad-pixels", "1");

    const html = await render();

    expect(html).toContain('data-mounted="meta-pixel"');
    expect(html).toContain('data-mounted="google-analytics"');
  });
});

// #445 — the site speaks English only: the page says so, the chrome carries no
// language switcher, and the home metadata names no Spanish twin.
describe("RootLayout — English only (#445)", () => {
  it('renders <html lang="en"> with no language switcher in the header or footer', async () => {
    const html = await render();

    expect(html).toContain('lang="en"');
    expect(html).not.toContain("Español");
    expect(html).not.toMatch(/href="\/es(?:[/"?])/);
  });

  it("emits a canonical with no hreflang cluster and no Spanish OG locale", async () => {
    const meta = await generateMetadata();

    expect(meta.alternates).toEqual({ canonical: "https://matio.tv" });
    expect(meta.openGraph).toMatchObject({ url: "https://matio.tv", locale: "en_US" });
    expect(meta.openGraph).not.toHaveProperty("alternateLocale");
  });
});
