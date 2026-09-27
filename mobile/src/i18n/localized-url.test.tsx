/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/shared/api-types";

// #288 item 12 — the legal pages Settings opens follow the language chosen in
// the app: Spanish is the site's /es twin, English the bare URL /v1/config
// already sends. #310 — and they open as the site's embed variant
// (`?embed=app`): the document alone, with no site header (its Subscribe link
// is a purchase outside the App Store) and no trackers. The helpers are pure;
// the last cases drive the real Settings screen to prove the rows use them
// with the LIVE choice.

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
      support: "mailto:contact@matio.tv",
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
import { LocaleProvider } from "./locale";
import { legalUrl, localizedUrl } from "./localized-url";

describe("localizedUrl", () => {
  it("puts a Spanish viewer on the /es twin of the page", () => {
    expect(localizedUrl("https://matio.tv/terms", "es")).toBe("https://matio.tv/es/terms");
    expect(localizedUrl("https://matio.tv/privacy", "es")).toBe("https://matio.tv/es/privacy");
    expect(localizedUrl("https://matio.tv/cookies", "es")).toBe("https://matio.tv/es/cookies");
    expect(localizedUrl("https://matio.tv", "es")).toBe("https://matio.tv/es");
    expect(localizedUrl("http://localhost:3100/terms", "es")).toBe("http://localhost:3100/es/terms");
  });

  it("leaves English on the bare URL", () => {
    expect(localizedUrl("https://matio.tv/terms", "en")).toBe("https://matio.tv/terms");
  });

  it("leaves anything that is not an absolute http(s) URL alone", () => {
    expect(localizedUrl("mailto:contact@matio.tv", "es")).toBe("mailto:contact@matio.tv");
    expect(localizedUrl("/terms", "es")).toBe("/terms");
  });

  it("keeps the query and fragment after the localized path", () => {
    expect(localizedUrl("https://matio.tv/terms?embed=app", "es")).toBe(
      "https://matio.tv/es/terms?embed=app",
    );
    expect(localizedUrl("https://matio.tv?embed=app#top", "es")).toBe(
      "https://matio.tv/es?embed=app#top",
    );
    expect(localizedUrl("https://matio.tv/privacy#s6", "es")).toBe("https://matio.tv/es/privacy#s6");
  });
});

describe("legalUrl (#310)", () => {
  it("opens the embed variant, in the chosen language", () => {
    expect(legalUrl("https://matio.tv/terms", "en")).toBe("https://matio.tv/terms?embed=app");
    expect(legalUrl("https://matio.tv/terms", "es")).toBe("https://matio.tv/es/terms?embed=app");
  });

  it("never adds the parameter twice — /v1/config already sends it", () => {
    expect(legalUrl("https://matio.tv/privacy?embed=app", "en")).toBe(
      "https://matio.tv/privacy?embed=app",
    );
    expect(legalUrl("https://matio.tv/privacy?embed=app", "es")).toBe(
      "https://matio.tv/es/privacy?embed=app",
    );
  });

  it("joins an existing query and keeps the fragment last", () => {
    expect(legalUrl("https://matio.tv/cookies?v=2#analytics", "en")).toBe(
      "https://matio.tv/cookies?v=2&embed=app#analytics",
    );
  });

  it("leaves anything that is not an absolute http(s) URL alone", () => {
    expect(legalUrl("mailto:contact@matio.tv", "es")).toBe("mailto:contact@matio.tv");
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

describe("Settings → About (#288 item 12)", () => {
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

  it("opens the legal pages in the language picked above them, not the phone's", () => {
    // An English phone…
    act(() =>
      root.render(
        <LocaleProvider initial="en">
          <SettingsScreen />
        </LocaleProvider>,
      ),
    );
    press("Terms of Service");
    expect(opened).toEqual(["https://matio.tv/terms?embed=app"]);

    // …on which the viewer picks Español.
    press("Español");
    press("Términos del servicio");
    press("Política de privacidad");
    press("Política de cookies");
    expect(opened.slice(1)).toEqual([
      "https://matio.tv/es/terms?embed=app",
      "https://matio.tv/es/privacy?embed=app",
      "https://matio.tv/es/cookies?embed=app",
    ]);
  });

  it("opens the embed variant as /v1/config sends it since #310, once", () => {
    legal.query = "?embed=app";
    act(() =>
      root.render(
        <LocaleProvider initial="en">
          <SettingsScreen />
        </LocaleProvider>,
      ),
    );
    press("Terms of Service");
    press("Privacy Policy");
    press("Cookie Policy");
    press("Español");
    press("Términos del servicio");
    expect(opened).toEqual([
      "https://matio.tv/terms?embed=app",
      "https://matio.tv/privacy?embed=app",
      "https://matio.tv/cookies?embed=app",
      "https://matio.tv/es/terms?embed=app",
    ]);
  });
});
