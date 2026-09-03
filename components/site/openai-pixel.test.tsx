/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_CHANGED_EVENT } from "@/lib/cookie-consent";

// next/script would try to load the real SDK; render it as a plain <script>
// so the test can inspect what WOULD be injected without executing it.
vi.mock("next/script", () => ({
  default: ({ id, children }: { id: string; children: string }) => (
    <script id={id} data-src-preview={children} />
  ),
}));

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

vi.mock("@/lib/openai-pixel-events", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/openai-pixel-events")>();
  return { ...mod, OPENAI_PIXEL_ID: "pix_test_123" };
});

import { OpenAIPixel } from "./openai-pixel";

const consented = { marketing: true, decidedAt: "2026-09-01T00:00:00.000Z" };
const declined = { marketing: false, decidedAt: "2026-09-01T00:00:00.000Z" };

function injected() {
  return document.getElementById("openai-pixel-base");
}

function consentChange(marketing: boolean) {
  window.dispatchEvent(
    new CustomEvent(CONSENT_CHANGED_EVENT, { detail: { marketing } }),
  );
}

beforeEach(() => {
  nav.pathname = "/";
});

afterEach(() => {
  cleanup();
  delete window.oaiq;
  delete window.__oaiqReady;
});

describe("OpenAIPixel — consent gate", () => {
  it("injects nothing without marketing consent", () => {
    render(<OpenAIPixel initialConsent={declined} />);
    expect(injected()).toBeNull();
    render(<OpenAIPixel initialConsent={null} />);
    expect(injected()).toBeNull();
  });

  it("injects the SDK snippet with the pixel id for an already-consented visitor", () => {
    render(<OpenAIPixel initialConsent={consented} />);
    const tag = injected();
    expect(tag).not.toBeNull();
    const src = tag!.getAttribute("data-src-preview") ?? "";
    expect(src).toContain("bzrcdn.openai.com/sdk/oaiq.min.js");
    expect(src).toContain('pixelId:"pix_test_123"');
    // debug is decided at build time from NODE_ENV (Vite inlines it, so the
    // value here follows the test runner's mode); what matters is that it is
    // always a boolean literal, never left to the SDK's default.
    expect(src).toMatch(/debug:(true|false)\}/);
  });

  it("injects after a consent decision made this session", () => {
    render(<OpenAIPixel initialConsent={null} />);
    expect(injected()).toBeNull();
    act(() => consentChange(true));
    expect(injected()).not.toBeNull();
  });

  it("flips the SDK's consent switch off on withdrawal and back on re-grant", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    render(<OpenAIPixel initialConsent={consented} />);
    act(() => consentChange(false));
    expect(oaiq).toHaveBeenCalledWith("consent", false);
    act(() => consentChange(true));
    expect(oaiq).toHaveBeenCalledWith("consent", true);
  });
});

describe("OpenAIPixel — page_viewed on navigation", () => {
  it("measures a new path once, but not the first page (the snippet did)", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    const view = render(<OpenAIPixel initialConsent={consented} />);
    expect(oaiq).not.toHaveBeenCalledWith("measure", "page_viewed", {
      type: "contents",
    });

    nav.pathname = "/shows/the-scarlet-oath";
    view.rerender(<OpenAIPixel initialConsent={consented} />);
    expect(oaiq).toHaveBeenCalledWith("measure", "page_viewed", {
      type: "contents",
    });
    expect(oaiq).toHaveBeenCalledTimes(1);

    // Same path re-rendered → no double count.
    view.rerender(<OpenAIPixel initialConsent={consented} />);
    expect(oaiq).toHaveBeenCalledTimes(1);
  });

  it("stops measuring navigations after consent is withdrawn", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    const view = render(<OpenAIPixel initialConsent={consented} />);
    act(() => consentChange(false));
    oaiq.mockClear();
    nav.pathname = "/about";
    view.rerender(<OpenAIPixel initialConsent={consented} />);
    expect(oaiq).not.toHaveBeenCalledWith(
      "measure",
      "page_viewed",
      expect.anything(),
    );
  });
});
