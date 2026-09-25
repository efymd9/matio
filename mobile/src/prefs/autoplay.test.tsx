/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #288 item 14 — a tester who turned «Play next episode automatically» off
// relaunched, opened Settings, and watched the switch render ON and then
// animate to OFF: the value is read from the keychain, and nothing had read
// it before Settings mounted. The root layout now starts that read at launch,
// next to the language read the splash waits on, so the switch's first frame
// is the stored value.

const store = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItemAsync: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("expo-secure-store", async () => {
  const { vi: vitest } = await import("vitest");
  store.getItemAsync = vitest.fn(async (key: string) => store.values.get(key) ?? null);
  return {
    getItemAsync: store.getItemAsync,
    setItemAsync: async (key: string, value: string) => {
      store.values.set(key, value);
    },
  };
});
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));

const AUTOPLAY_KEY = "matio_autoplay_next";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

// Every value the Settings switch would render, in order.
const frames: boolean[] = [];

async function renderSwitch() {
  const { useAutoplayNext } = await import("./autoplay");
  function Switch() {
    const [enabled] = useAutoplayNext();
    frames.push(enabled);
    return null;
  }
  act(() => root.render(<Switch />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("__DEV__", false);
  store.values.clear();
  store.values.set(AUTOPLAY_KEY, "0");
  frames.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the autoplay setting on Settings' first open (#288 item 14)", () => {
  it("renders the stored «off» from its first frame once the read has been primed", async () => {
    const { loadAutoplayNext } = await import("./autoplay");
    await loadAutoplayNext();

    await renderSwitch();

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((value) => value === false)).toBe(true);
  });

  it("unprimed, the first frame is the default «on» that then flips — the glitch the prime removes", async () => {
    await renderSwitch();

    expect(frames[0]).toBe(true);
    expect(frames.at(-1)).toBe(false);
  });

  it("the root layout starts the read at launch, before anything renders", async () => {
    vi.doMock("expo-splash-screen", () => ({
      preventAutoHideAsync: () => Promise.resolve(),
      hideAsync: () => Promise.resolve(),
    }));
    vi.doMock("expo-router", () => ({ DarkTheme: { colors: {} }, Stack: () => null, ThemeProvider: () => null }));
    vi.doMock("expo-status-bar", () => ({ StatusBar: () => null }));
    vi.doMock("@expo-google-fonts/anton", () => ({ Anton_400Regular: 0, useFonts: () => [true, null] }));
    vi.doMock("@expo-google-fonts/geist", () => ({ Geist_400Regular: 0, Geist_600SemiBold: 0 }));
    vi.doMock("@expo-google-fonts/geist-mono", () => ({ GeistMono_400Regular: 0 }));
    vi.doMock("react-native-safe-area-context", () => ({ SafeAreaProvider: () => null }));
    vi.doMock("@/api/config-context", () => ({ ConfigProvider: () => null }));
    vi.doMock("@/auth/clerk", () => ({ AuthProvider: () => null }));
    vi.doMock("@/orientation", () => ({ lockOrientation: () => undefined, PORTRAIT_LOCK: 0 }));
    store.getItemAsync.mockClear();

    await import("@/app/_layout");

    expect(store.getItemAsync).toHaveBeenCalledWith(AUTOPLAY_KEY);
  });
});
