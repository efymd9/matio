/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/shared/api-types";

// #310 — the legal pages Settings opens are the site's embed variant
// (`?embed=app`): the document alone, with no site header (its Subscribe link
// is a purchase outside the App Store) and no trackers. At the English URL
// /v1/config sends: until #447 a viewer who picked Español got the /es twin
// (#288 item 12); the app is English-only now, and so is every link. The
// helper is pure; the last cases drive the real Settings screen to prove the
// rows use it.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

const opened = vi.hoisted(() => [] as string[]);
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: async (url: string) => {
    opened.push(url);
    return {};
  },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" }, nativeBuildVersion: "6" },
}));
const legal = vi.hoisted(() => ({ query: "" }));
vi.mock("@/api/config-context", () => ({
  useConfig: (): Partial<AppConfig> => ({
    urls: {
      web: "https://matio.tv",
      terms: `https://matio.tv/terms${legal.query}`,
      privacy: `https://matio.tv/privacy${legal.query}`,
      cookies: `https://matio.tv/cookies${legal.query}`,
      support: "mailto:maksym@matio.tv",
    },
  }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: unknown }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import SettingsScreen from "@/app/(tabs)/settings";
import { legalUrl } from "./legal-url";

describe("legalUrl (#310)", () => {
  it("opens the embed variant of the English document", () => {
    expect(legalUrl("https://matio.tv/terms")).toBe("https://matio.tv/terms?embed=app");
    expect(legalUrl("http://localhost:3100/privacy")).toBe("http://localhost:3100/privacy?embed=app");
  });

  it("never adds the parameter twice — /v1/config already sends it", () => {
    expect(legalUrl("https://matio.tv/privacy?embed=app")).toBe("https://matio.tv/privacy?embed=app");
  });

  it("joins an existing query and keeps the fragment last", () => {
    expect(legalUrl("https://matio.tv/cookies?v=2#analytics")).toBe(
      "https://matio.tv/cookies?v=2&embed=app#analytics",
    );
  });

  it("leaves anything that is not an absolute http(s) URL alone", () => {
    expect(legalUrl("mailto:maksym@matio.tv")).toBe("mailto:maksym@matio.tv");
    expect(legalUrl("/terms")).toBe("/terms");
  });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Settings → About (#310)", () => {
  beforeEach(() => {
    opened.length = 0;
    legal.query = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens each document's embed page even from a server that sends the bare URL", () => {
    act(() => root.render(<SettingsScreen />));
    press("Terms of Service");
    press("Privacy Policy");
    press("Cookie Policy");

    expect(opened).toEqual([
      "https://matio.tv/terms?embed=app",
      "https://matio.tv/privacy?embed=app",
      "https://matio.tv/cookies?embed=app",
    ]);
  });

  it("opens the embed variant as /v1/config sends it since #310, once", () => {
    legal.query = "?embed=app";
    act(() => root.render(<SettingsScreen />));
    press("Terms of Service");
    press("Privacy Policy");
    press("Cookie Policy");

    expect(opened).toEqual([
      "https://matio.tv/terms?embed=app",
      "https://matio.tv/privacy?embed=app",
      "https://matio.tv/cookies?embed=app",
    ]);
  });
});
