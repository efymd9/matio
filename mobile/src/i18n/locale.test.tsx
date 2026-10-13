/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nManager } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@/shared/api-types";

// #447 — the app is English-only (after the website, #445). The phone below
// is set to Spanish in both places the app used to read it from (Android's
// I18nManager constant, Hermes' Intl on iOS), and its keychain still holds
// the «es» an older build's Settings → Language wrote. It gets the English
// app all the same: rendered from the REAL root layout down to the Settings
// tab, which has no Language group left to change it.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

// The keychain of a phone that once picked Español, and what the app asks it.
const keychain = vi.hoisted(() => ({ reads: [] as string[], writes: [] as string[] }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => {
    keychain.reads.push(key);
    return key === "matio_locale" ? "es" : null;
  },
  setItemAsync: async (key: string) => {
    keychain.writes.push(key);
  },
}));

// The root stack renders the Settings tab in its place — set once it is
// imported below.
const stack = vi.hoisted(() => ({ screen: null as null | (() => ReactNode) }));
vi.mock("expo-router", () => ({
  useRouter: () => ({}),
  DarkTheme: { dark: true, colors: {} },
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  Stack: Object.assign(() => stack.screen?.() ?? null, { Screen: () => null }),
}));
vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => undefined,
  hideAsync: async () => undefined,
}));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("@expo-google-fonts/anton", () => ({ Anton_400Regular: 0, useFonts: () => [true, null] }));
vi.mock("@expo-google-fonts/geist", () => ({ Geist_400Regular: 0, Geist_600SemiBold: 0 }));
vi.mock("@expo-google-fonts/geist-mono", () => ({ GeistMono_400Regular: 0 }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("@/auth/clerk", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/api/config-context", () => ({
  ConfigProvider: ({ children }: { children: ReactNode }) => children,
  useConfig: (): Partial<AppConfig> => ({
    urls: {
      web: "https://matio.tv",
      terms: "https://matio.tv/terms?embed=app",
      privacy: "https://matio.tv/privacy?embed=app",
      cookies: "https://matio.tv/cookies?embed=app",
      support: "mailto:maksym@matio.tv",
    },
  }),
}));
vi.mock("@/orientation", () => ({ lockOrientation: () => undefined, PORTRAIT_LOCK: 0 }));
vi.mock("@/components/glass-tab-bar", () => ({ useTabBarClearance: () => 0 }));
const opened = vi.hoisted(() => [] as string[]);
vi.mock("expo-web-browser", () => ({
  openBrowserAsync: async (url: string) => {
    opened.push(url);
    return {};
  },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" }, nativeBuildVersion: "7" },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import RootLayout from "@/app/_layout";
import SettingsScreen from "@/app/(tabs)/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
stack.screen = () => <SettingsScreen />;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  keychain.reads.length = 0;
  keychain.writes.length = 0;
  opened.length = 0;
  // A Spanish phone, as each platform reports it.
  vi.spyOn(I18nManager, "getConstants").mockReturnValue({
    isRTL: false,
    localeIdentifier: "es_ES",
  } as ReturnType<typeof I18nManager.getConstants>);
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolvedOptions.call(this), locale: "es-ES" };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

// The root layout, and the keychain read an older build held the splash on.
async function launch() {
  await act(async () => {
    root.render(<RootLayout />);
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the app is English-only (#447)", () => {
  it("a phone set to Spanish, with Español still in the keychain, gets the English app", async () => {
    await launch();

    expect(text()).toContain("Settings");
    expect(text()).toContain("Play next episode automatically");
    expect(text()).toContain("Terms of Service");
    expect(text()).not.toContain("Ajustes");
    expect(text()).not.toContain("Reproducción");
  });

  it("the language choice older builds stored is neither read nor written", async () => {
    await launch();
    press("Terms of Service");

    expect(keychain.reads).not.toContain("matio_locale");
    expect(keychain.writes).not.toContain("matio_locale");
  });

  it("Settings has no Language group — nothing to choose, no radio rows", async () => {
    await launch();

    expect(text()).not.toContain("Language");
    expect(text()).not.toContain("Español");
    expect(text()).not.toContain("English");
    expect(container.querySelector('[role="radio"]')).toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("the legal rows open the English documents, never an /es URL", async () => {
    await launch();
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
