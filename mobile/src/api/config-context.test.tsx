/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/shared/api-types";

// The launch gate every screen sits behind (#288 items 6 and 7):
//   - the build floor compares /v1/config's minSupportedBuild with THIS
//     binary's native build number — no longer a literal 1 in every build;
//   - a launch that cannot reach Matio says so in the viewer's language —
//     never the client's English error string, a server's own sentence or
//     the API's address, which only a dev build still shows.

const native = vi.hoisted(() => ({ nativeBuildVersion: "6" as string | null }));
vi.mock("expo-constants", () => ({ default: native }));

const config = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown>) }));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, api: { config: () => config.answer?.() } };
});

vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: unknown }) => children ?? null,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

const CONFIG: AppConfig = {
  apiVersion: 1,
  minSupportedBuild: 1,
  latestBuild: 6,
  flags: { paymentsEnabled: true, downloadsEnabled: false, castEnabled: false },
  signupGate: { mode: "tiers" },
  locales: ["es", "en"],
  urls: {
    web: "https://matio.tv",
    terms: "https://matio.tv/terms",
    privacy: "https://matio.tv/privacy",
    cookies: "https://matio.tv/cookies",
    support: "mailto:contact@matio.tv",
  },
};

let container: HTMLDivElement;
let root: Root | null = null;
const text = () => container.textContent ?? "";

async function renderProvider(locale: "en" | "es" = "en") {
  vi.resetModules();
  const { ConfigProvider } = await import("@/api/config-context");
  const { LocaleProvider } = await import("@/i18n/locale");
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleProvider initial={locale}>
        <ConfigProvider>
          <span>the app</span>
        </ConfigProvider>
      </LocaleProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function networkError() {
  const { ApiError } = await import("@/api/client");
  return new ApiError("network", "Couldn't reach Matio.", 0);
}

describe("ConfigProvider (#288)", () => {
  beforeEach(() => {
    vi.stubGlobal("__DEV__", false);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    native.nativeBuildVersion = "6";
    config.answer = async () => CONFIG;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllGlobals();
  });

  it("lets build 6 through a floor of 2 — the floor retires OLDER builds, not every build", async () => {
    config.answer = async () => ({ ...CONFIG, minSupportedBuild: 2 });
    await renderProvider();

    expect(text()).toContain("the app");
    expect(text()).not.toContain("Update Matio");
  });

  it("walls build 6 once the floor passes it", async () => {
    config.answer = async () => ({ ...CONFIG, minSupportedBuild: 7 });
    await renderProvider();

    expect(text()).toContain("Update Matio");
    expect(text()).not.toContain("the app");
  });

  // #292 item 3 — the wall's one button leads to the update (TestFlight,
  // while the app is not in the App Store), never to the website.
  describe("the update button", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function pressUpdate(openURL: (url: string) => Promise<unknown>) {
      config.answer = async () => ({ ...CONFIG, minSupportedBuild: 7 });
      await renderProvider();
      // The module instance the freshly imported provider uses.
      const { Linking } = await import("react-native");
      const spy = vi.spyOn(Linking, "openURL").mockImplementation(openURL as never);
      const node = Array.from(container.querySelectorAll("*")).find(
        (el) => el.children.length === 0 && el.textContent === "Update",
      );
      if (!node) throw new Error("no Update button");
      await act(async () => {
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      return spy;
    }

    it("opens the TestFlight app", async () => {
      const spy = await pressUpdate(async () => true);

      expect(spy.mock.calls).toEqual([["itms-beta://"]]);
      // A plain CTA, not a play button.
      expect(container.querySelector('[data-testid="play-glyph"]')).toBeNull();
    });

    it("falls back to Apple's TestFlight page where the app is not installed — never to matio.tv", async () => {
      const spy = await pressUpdate(async (url) => {
        if (url === "itms-beta://") throw new Error("No app handles itms-beta://");
        return true;
      });

      expect(spy.mock.calls).toEqual([["itms-beta://"], ["https://testflight.apple.com/"]]);
    });

    it("reads Spanish to a Spanish viewer", async () => {
      config.answer = async () => ({ ...CONFIG, minSupportedBuild: 7 });
      await renderProvider("es");

      expect(text()).toContain("Actualizar");
      expect(text()).not.toContain("matio.tv");
    });
  });

  it("an unreachable Matio reads as a connection problem — no English error, no API address", async () => {
    const error = await networkError();
    config.answer = async () => {
      throw error;
    };
    await renderProvider();

    expect(text()).toContain("Couldn't reach Matio");
    expect(text()).toContain("Check your connection and try again.");
    expect(text()).not.toContain("Couldn't reach Matio.");
    expect(text()).not.toContain("https://matio.tv");
  });

  it("a Spanish viewer reads Spanish, never the server's English sentence", async () => {
    const { ApiError } = await import("@/api/client");
    const error = new ApiError("server_error", "Your preview has ended.", 503);
    config.answer = async () => {
      throw error;
    };
    await renderProvider("es");

    expect(text()).toContain("No conseguimos conectar con Matio");
    expect(text()).toContain("Algo salió mal. Inténtalo de nuevo.");
    expect(text()).not.toContain("Your preview has ended.");
    expect(text()).not.toContain("Request failed");
  });

  it("a dev build still names the error and the base URL, for whoever runs the dev server", async () => {
    vi.stubGlobal("__DEV__", true);
    const error = await networkError();
    config.answer = async () => {
      throw error;
    };
    await renderProvider();
    const { API_BASE_URL } = await import("@/api/client");

    expect(text()).toContain("Check your connection and try again.");
    expect(text()).toContain("Couldn't reach Matio.");
    expect(text()).toContain(API_BASE_URL);
  });
});
