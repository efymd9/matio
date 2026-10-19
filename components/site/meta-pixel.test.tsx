/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSION, type ConsentRecord } from "@/lib/cookie-consent";

// next/script would load the real fbevents.js; render it as a plain <script>
// so the test reads what WOULD run without executing it.
vi.mock("next/script", () => ({
  default: ({ id, children }: { id: string; children: string }) => (
    <script id={id} data-src-preview={children} />
  ),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/watch/some-show" }));

// Two pixels — the primary and one extra — like production
// (NEXT_PUBLIC_META_PIXEL_ID + NEXT_PUBLIC_META_PIXEL_IDS).
vi.mock("@/lib/meta-pixel-events", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/meta-pixel-events")>();
  return { ...mod, META_PIXEL_IDS: ["1110000000000001", "2220000000000002"] };
});

import { MetaPixel } from "./meta-pixel";

const consented: ConsentRecord = { necessary: true, marketing: true, ts: 0, v: CONSENT_VERSION };

function snippet(): string {
  return document.getElementById("meta-pixel-base")?.getAttribute("data-src-preview") ?? "";
}

afterEach(() => {
  cleanup();
});

describe("MetaPixel — consent gate", () => {
  it("injects nothing without marketing consent", () => {
    render(<MetaPixel initialConsent={null} />);
    expect(document.getElementById("meta-pixel-base")).toBeNull();
    render(
      <MetaPixel initialConsent={{ necessary: true, marketing: false, ts: 0, v: CONSENT_VERSION }} />,
    );
    expect(document.getElementById("meta-pixel-base")).toBeNull();
  });
});

// #466 — no ad event names a video. Meta's automatic configuration is on by
// default and sends events our code never builds: SubscribedButtonClick with
// the clicked button's text (an episode title in the /watch episodes overlay,
// a fork option's label) and Microdata with the page's title / OpenGraph /
// JSON-LD (the show on /shows/<slug>). It is switched off in the snippet, for
// every pixel, above that pixel's init.
describe("MetaPixel — automatic configuration off (#466)", () => {
  it("switches autoConfig off for every pixel, before that pixel's init", () => {
    render(<MetaPixel initialConsent={consented} />);
    const src = snippet();
    for (const id of ["1110000000000001", "2220000000000002"]) {
      const off = src.indexOf(`fbq('set', 'autoConfig', false, '${id}');`);
      const init = src.indexOf(`fbq('init', '${id}');`);
      expect(off, id).toBeGreaterThan(-1);
      expect(init, id).toBeGreaterThan(off);
    }
  });

  it("never initialises a pixel that kept automatic configuration", () => {
    render(<MetaPixel initialConsent={consented} />);
    const src = snippet();
    const inits = [...src.matchAll(/fbq\('init', '(\d+)'\);/g)].map((m) => m[1]);
    const offs = [...src.matchAll(/fbq\('set', 'autoConfig', false, '(\d+)'\);/g)].map(
      (m) => m[1],
    );
    expect(inits).toEqual(["1110000000000001", "2220000000000002"]);
    expect(offs).toEqual(inits);
    // The first PageView goes out only after every pixel is configured.
    expect(src.indexOf("fbq('track', 'PageView');")).toBeGreaterThan(
      src.lastIndexOf("fbq('init',"),
    );
  });
});
