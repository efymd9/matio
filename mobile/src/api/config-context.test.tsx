/** @vitest-environment jsdom */
import { act, useEffect, type ReactNode } from "react";
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

const config = vi.hoisted(() => ({
  answer: null as null | (() => Promise<unknown>),
  requests: 0,
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      config: () => {
        config.requests += 1;
        return config.answer?.();
      },
    },
  };
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
    support: "mailto:maksym@matio.tv",
  },
};

let container: HTMLDivElement;
let root: Root | null = null;
const text = () => container.textContent ?? "";

type ConfigModule = typeof import("@/api/config-context");

// The AppState "change" listener the provider installed (null once removed)
// and how many times one was removed.
let onAppState: ((state: string) => void) | null = null;
let listenersRemoved = 0;

async function renderProvider(
  locale: "en" | "es" = "en",
  body: (mod: ConfigModule) => ReactNode = () => <span>the app</span>,
) {
  vi.resetModules();
  // The module instance the freshly imported provider will use.
  const { AppState } = await import("react-native");
  vi.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    const listener = handler as (state: string) => void;
    onAppState = listener;
    return {
      remove: () => {
        listenersRemoved += 1;
        if (onAppState === listener) onAppState = null;
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  const mod = await import("@/api/config-context");
  const { LocaleProvider } = await import("@/i18n/locale");
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleProvider initial={locale}>
        <mod.ConfigProvider>{body(mod)}</mod.ConfigProvider>
      </LocaleProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return mod;
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
    config.requests = 0;
    onAppState = null;
    listenersRemoved = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  // #301 — the config while the app stays in memory. It used to be fetched
  // once per process: a raised floor never retired a running build, flipped
  // kill-switches went stale, and a launch that failed stayed failed until
  // Retry. A return to the foreground now refreshes a config older than five
  // minutes (or one that never arrived) SILENTLY, one request at a time, and
  // an unchanged answer keeps the object every screen already holds.
  describe("refresh on a return to the app (#301)", () => {
    // Every config the app's screens were handed, and how many times they
    // mounted: a spinner or an error screen in between unmounts them.
    let seen: AppConfig[] = [];
    let mounts = 0;

    function probe({ useConfig }: ConfigModule) {
      function Probe() {
        const current = useConfig();
        seen.push(current);
        useEffect(() => {
          mounts += 1;
        }, []);
        return <span>{`the app · payments ${current.flags.paymentsEnabled ? "on" : "off"}`}</span>;
      }
      return <Probe />;
    }

    async function settle() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    async function foregroundAfter(ms: number) {
      vi.setSystemTime(Date.now() + ms);
      act(() => onAppState?.("background"));
      act(() => onAppState?.("active"));
      await settle();
    }

    // An answer that lands only when the test says so.
    function deferAnswer() {
      const answer: { land: (value: AppConfig) => void } = { land: () => undefined };
      config.answer = () =>
        new Promise<AppConfig>((resolve) => {
          answer.land = resolve;
        });
      return answer;
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      seen = [];
      mounts = 0;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("a floor raised while the app was away walls this build at the next return", async () => {
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);
      expect(text()).toContain("the app");

      config.answer = async () => ({ ...CONFIG, minSupportedBuild: 7 });
      await foregroundAfter(CONFIG_STALE_MS);

      expect(config.requests).toBe(2);
      expect(text()).toContain("Update Matio");
      expect(text()).not.toContain("the app");
    });

    it("a quick return does not refetch; the first return past five minutes does", async () => {
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);
      expect(CONFIG_STALE_MS).toBe(5 * 60_000);

      await foregroundAfter(CONFIG_STALE_MS - 1_000);
      expect(config.requests).toBe(1);

      await foregroundAfter(1_000);
      expect(config.requests).toBe(2);
    });

    it("a launch that could not reach Matio recovers on the next return, without Retry", async () => {
      const error = await networkError();
      config.answer = async () => {
        throw error;
      };
      await renderProvider("en", probe);
      expect(text()).toContain("Couldn't reach Matio");

      config.answer = async () => CONFIG;
      await foregroundAfter(1_000);

      expect(config.requests).toBe(2);
      expect(text()).toContain("the app · payments on");
      expect(text()).not.toContain("Couldn't reach Matio");
    });

    it("an unchanged config keeps its object, and still restarts the five minutes", async () => {
      // A fresh object per answer, as JSON.parse hands one back.
      config.answer = async () => structuredClone(CONFIG);
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);

      await foregroundAfter(CONFIG_STALE_MS);
      expect(config.requests).toBe(2);
      // The five minutes count from that unchanged answer.
      await foregroundAfter(CONFIG_STALE_MS - 1_000);
      expect(config.requests).toBe(2);

      // One object throughout, so no memo that reads it (config.signupGate
      // in the lock rules) recomputes.
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen).size).toBe(1);
    });

    it("a refresh never drops the app back to a spinner, and a new answer swaps in", async () => {
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);
      expect(text()).toContain("payments on");

      const answer = deferAnswer();
      await foregroundAfter(CONFIG_STALE_MS);
      // In flight: the app stays exactly as it was.
      expect(config.requests).toBe(2);
      expect(text()).toContain("the app · payments on");

      await act(async () => {
        answer.land({ ...CONFIG, flags: { ...CONFIG.flags, paymentsEnabled: false } });
      });
      await settle();

      expect(text()).toContain("the app · payments off");
      expect(mounts).toBe(1);
    });

    it("a refresh that fails keeps the app — never the unreachable screen over a working app", async () => {
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);
      const error = await networkError();
      config.answer = async () => {
        throw error;
      };

      await foregroundAfter(CONFIG_STALE_MS);

      expect(config.requests).toBe(2);
      expect(text()).toContain("the app · payments on");
      expect(text()).not.toContain("Couldn't reach Matio");
      expect(mounts).toBe(1);
    });

    it("one request at a time: a return during the launch request, or two quick returns, share it", async () => {
      // A return while the launch request is still out does not send a second.
      const launch = deferAnswer();
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);
      await foregroundAfter(CONFIG_STALE_MS);
      expect(config.requests).toBe(1);
      await act(async () => {
        launch.land(CONFIG);
      });
      await settle();
      expect(text()).toContain("the app · payments on");

      // Two quick returns: one request in flight, not two answers racing
      // into the state in whatever order the network hands them back.
      const refresh = deferAnswer();
      await foregroundAfter(CONFIG_STALE_MS);
      await foregroundAfter(1_000);
      expect(config.requests).toBe(2);
      await act(async () => {
        refresh.land({ ...CONFIG, minSupportedBuild: 7 });
      });
      await settle();
      expect(text()).toContain("Update Matio");

      // Settled, so the guard is released: a floor lowered again lets the
      // build back in at the next stale return.
      config.answer = async () => CONFIG;
      await foregroundAfter(CONFIG_STALE_MS);
      expect(config.requests).toBe(3);
      expect(text()).toContain("the app");
    });

    it("unmounting removes the listener, and an answer still in flight lands nowhere", async () => {
      const { CONFIG_STALE_MS } = await renderProvider("en", probe);
      const answer = deferAnswer();
      await foregroundAfter(CONFIG_STALE_MS);
      expect(config.requests).toBe(2);

      const errors = vi.spyOn(console, "error");
      act(() => root?.unmount());
      root = null;
      // Once, at unmount: the listener was not re-subscribed along the way.
      expect(listenersRemoved).toBe(1);

      await act(async () => {
        answer.land(CONFIG);
      });
      await settle();
      expect(errors).not.toHaveBeenCalled();
      expect(onAppState).toBeNull();
    });
  });
});
