/** @vitest-environment jsdom */
import {
  act,
  Component,
  type ComponentType,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorBoundaryProps } from "expo-router";
import type { ShowDetail } from "@/shared/api-types";

// #308 — a render exception no longer closes the app. Every route of the
// root stack exports an `ErrorBoundary` (the tab group from its layout), and
// the root layout exports the last resort. Rendered for real in jsdom on
// react-native-web, each route inside the wrapper expo-router puts around a
// route that has one; the router, the API, Clerk and the native modules are
// faked. (Not under app/ — a test file there would become a route.)

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  canGoBack: vi.fn(() => true),
};
let params: Record<string, string | undefined> = {};
vi.mock("expo-router", async () => {
  const { useEffect } = await import("react");
  return {
    useRouter: () => router,
    useLocalSearchParams: () => params,
    // The screen is focused from mount to unmount — what useFocusEffect does
    // for a screen nothing is pushed over.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffect(() => effect(), [effect]);
    },
    DarkTheme: { dark: true, colors: {} },
    ThemeProvider: ({ children }: { children: ReactNode }) => children,
    Stack: Object.assign(() => "root stack", { Screen: () => null }),
  };
});

// Whatever a crash must be able to come from — each flag makes one piece
// throw while it renders.
const crash = vi.hoisted(() => ({
  tab: null as null | Error,
  feed: false,
  clerkHook: false,
  rootProvider: false,
}));
const CRASH_MESSAGE = "viewer ana@example.com, card ending 4242";

vi.mock("expo-router/js-tabs", () => ({
  // One scene stands in for the focused tab.
  Tabs: Object.assign(
    ({ children }: { children: ReactNode }) => {
      if (crash.tab) throw crash.tab;
      return (
        <>
          {children}
          home tab
        </>
      );
    },
    { Screen: () => null },
  ),
}));
vi.mock("@/api/catalog-context", () => ({
  CatalogProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/glass-tab-bar", () => ({ GlassTabBar: () => null }));

const show = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown>) }));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      show: () => show.answer?.(),
      continueWatching: async () => ({ items: [] }),
    },
  };
});
vi.mock("@/api/config-context", () => ({
  useConfig: () => ({ signupGate: { mode: "tiers" } }),
  ConfigProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => {
    if (crash.clerkHook) throw new Error(CRASH_MESSAGE);
    return { isLoaded: true, isSignedIn: false, stalled: false, retry: () => undefined };
  },
  AuthProvider: ({ children }: { children: ReactNode }) => {
    if (crash.rootProvider) throw new Error(CRASH_MESSAGE);
    return children;
  },
}));
vi.mock("@/components/sign-in-form", () => ({ SignInForm: () => "sign-in form" }));

const feed = vi.hoisted(() => ({ mounted: false }));
vi.mock("@/watch/episode-feed", () => ({
  EpisodeFeed: () => {
    if (crash.feed) throw new Error(CRASH_MESSAGE);
    feed.mounted = true;
    return null;
  },
}));

// The orientation module itself is real: whatever lock the player took, the
// native side sees it here.
const orientation = vi.hoisted(() => ({
  PORTRAIT_UP: 1,
  LANDSCAPE: 2,
  lockAsync: vi.fn(async (_lock: number) => undefined),
}));
vi.mock("expo-screen-orientation", () => ({
  OrientationLock: { PORTRAIT_UP: orientation.PORTRAIT_UP, LANDSCAPE: orientation.LANDSCAPE },
  lockAsync: orientation.lockAsync,
}));

// The keychain answers «es» for the stored language: a fallback rendered
// INSIDE the locale provider would come out in Spanish.
const keychain = vi.hoisted(() => ({ locale: null as string | null }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => (key === "matio_locale" ? keychain.locale : null),
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: async () => undefined,
  hideAsync: async () => undefined,
}));
vi.mock("@expo-google-fonts/anton", () => ({
  Anton_400Regular: "anton",
  useFonts: () => [true, null],
}));
vi.mock("@expo-google-fonts/geist", () => ({
  Geist_400Regular: "geist",
  Geist_600SemiBold: "geist-semibold",
}));
vi.mock("@expo-google-fonts/geist-mono", () => ({ GeistMono_400Regular: "geist-mono" }));
vi.mock("@/prefs/autoplay", () => ({ loadAutoplayNext: async () => true }));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

import * as RootLayoutRoute from "@/app/_layout";
import * as TabsRoute from "@/app/(tabs)/_layout";
import * as ShowRoute from "@/app/show/[slug]";
import * as SignInRoute from "@/app/sign-in";
import * as WatchRoute from "@/app/watch/[episodeId]";
import { LocaleProvider } from "@/i18n/locale";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// expo-router 57's own wrapper for a route that exports `ErrorBoundary`
// (build/views/Try.js, applied in useScreens.js:fromImport), line for line
// minus the splash call — the real one cannot load here: its splash helper
// requires the native `expo` module.
class Try extends Component<
  { catch: ComponentType<ErrorBoundaryProps>; children: ReactNode },
  { error?: Error }
> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  retry = () =>
    new Promise<void>((resolve) => {
      this.setState({ error: undefined }, resolve);
    });
  render() {
    const { catch: Fallback, children } = this.props;
    return this.state.error ? <Fallback error={this.state.error} retry={this.retry} /> : children;
  }
}

type RouteModule = { default: ComponentType; ErrorBoundary?: ComponentType<ErrorBoundaryProps> };

// A route as expo-router mounts it. No `ErrorBoundary` export = no wrapper,
// exactly as there: the crash goes on up and takes the app with it.
function Route({ module }: { module: RouteModule }) {
  const Screen = module.default;
  const Boundary = module.ErrorBoundary;
  return Boundary ? (
    <Try catch={Boundary}>
      <Screen />
    </Try>
  ) : (
    <Screen />
  );
}

const SHOW: ShowDetail = {
  id: "show-1",
  slug: "the-scarlet-oath",
  title: "The Scarlet Oath",
  synopsis: null,
  genre: [],
  orientation: "horizontal",
  posterImageUrl: null,
  heroImageUrl: null,
  episodeCount: 1,
  featured: false,
  justReleased: false,
  popularNow: false,
  episodes: [
    {
      id: "ep1",
      seasonNumber: 1,
      number: 1,
      title: "Episode 1",
      description: null,
      durationSeconds: 600,
      access: "free",
      releasedAt: null,
      thumbnailUrl: null,
      introStartSeconds: null,
      introEndSeconds: null,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

// Renders and lets the fetches and the effects behind them settle.
async function render(element: ReactNode) {
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// The window react-native-web's useWindowDimensions reads: jsdom has no
// visualViewport and no layout, so RNW falls back to documentElement's
// client size (0 × 0) — defined here, then the `resize` RNW listens to.
function setWindow(width: number, height: number) {
  const docEl = document.documentElement;
  Object.defineProperty(docEl, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(docEl, "clientHeight", { configurable: true, get: () => height });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

const FALLBACK_EN = ["Something glitched", "We'll catch the next take.", "Try again"];

beforeEach(() => {
  for (const fn of [router.push, router.replace, router.back]) fn.mockClear();
  router.canGoBack.mockReset().mockReturnValue(true);
  orientation.lockAsync.mockClear();
  params = {};
  show.answer = async () => SHOW;
  crash.tab = null;
  crash.feed = false;
  crash.clerkHook = false;
  crash.rootProvider = false;
  feed.mounted = false;
  keychain.locale = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  // React's own report of a caught error is not under test (and is a
  // development aid); what the fallback itself prints is.
  root = createRoot(container, { onCaughtError: () => undefined });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("a crash on a pushed screen stays on that screen (#308)", () => {
  it("the show page: a show DTO that drifted renders the fallback, and Back leaves", async () => {
    params = { slug: "the-scarlet-oath" };
    // `episodes` gone from the wire: the page reads episodes[0] and throws.
    show.answer = async () => ({ ...SHOW, episodes: undefined });
    await render(<Route module={ShowRoute} />);

    for (const line of FALLBACK_EN) expect(text()).toContain(line);
    await press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("the show page: Try again mounts it afresh — a fixed answer shows the show", async () => {
    params = { slug: "the-scarlet-oath" };
    show.answer = async () => ({ ...SHOW, episodes: undefined });
    await render(<Route module={ShowRoute} />);
    expect(text()).toContain("Something glitched");

    show.answer = async () => SHOW;
    await press("Try again");

    expect(text()).toContain("The Scarlet Oath");
    expect(text()).not.toContain("Something glitched");
  });

  it("the player: a crash in the landscape feed hands portrait back, and Back leaves", async () => {
    params = { episodeId: "ep1", showSlug: "the-scarlet-oath" };
    // A phone already turned: the feed mounts as soon as the lock is taken.
    setWindow(844, 390);
    await render(<Route module={WatchRoute} />);
    expect(feed.mounted).toBe(true);
    expect(orientation.lockAsync).toHaveBeenLastCalledWith(orientation.LANDSCAPE);

    crash.feed = true;
    await render(<Route module={WatchRoute} />);

    for (const line of FALLBACK_EN) expect(text()).toContain(line);
    // The boundary unmounted the player, and its lock went with it: the
    // fallback — and the screen Back returns to — are upright.
    expect(orientation.lockAsync).toHaveBeenLastCalledWith(orientation.PORTRAIT_UP);
    await press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(orientation.lockAsync).toHaveBeenLastCalledWith(orientation.PORTRAIT_UP);
  });

  it("sign-in: a Clerk hook that throws renders the fallback; Try again brings the form back", async () => {
    crash.clerkHook = true;
    await render(<Route module={SignInRoute} />);
    for (const line of FALLBACK_EN) expect(text()).toContain(line);

    crash.clerkHook = false;
    await press("Try again");
    expect(text()).toContain("sign-in form");
    expect(text()).not.toContain("Something glitched");
  });

  it("sign-in opened cold from a link: Back goes Home", async () => {
    router.canGoBack.mockReturnValue(false);
    crash.clerkHook = true;
    await render(<Route module={SignInRoute} />);

    await press("Back");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });
});

describe("a crash in a tab stays in the tab group (#308)", () => {
  it("renders the fallback in the group's place; Back goes Home — nothing is under the tabs — and Try again remounts it", async () => {
    // Nothing is under the tabs.
    router.canGoBack.mockReturnValue(false);
    crash.tab = new Error(CRASH_MESSAGE);
    await render(<Route module={TabsRoute} />);

    for (const line of FALLBACK_EN) expect(text()).toContain(line);
    await press("Back");
    expect(router.replace).toHaveBeenCalledWith("/");

    crash.tab = null;
    await press("Try again");
    expect(text()).toContain("home tab");
  });

  it("speaks the viewer's language — it renders inside the locale provider", async () => {
    crash.tab = new Error(CRASH_MESSAGE);
    await render(
      <LocaleProvider initial="es">
        <Route module={TabsRoute} />
      </LocaleProvider>,
    );

    expect(text()).toContain("Algo falló");
    expect(text()).toContain("Intentar de nuevo");
    expect(text()).toContain("Volver");
  });
});

describe("the root layout's last resort (#308)", () => {
  it("catches a crashing provider — outside the locale provider, in English, Try again only", async () => {
    keychain.locale = "es";
    crash.rootProvider = true;
    await render(<Route module={RootLayoutRoute} />);

    for (const line of FALLBACK_EN) expect(text()).toContain(line);
    expect(text()).not.toContain("Back");

    crash.rootProvider = false;
    await press("Try again");
    expect(text()).toContain("root stack");
    expect(text()).not.toContain("Something glitched");
  });

  it("renders with no provider above it at all", async () => {
    const Fallback = RootLayoutRoute.ErrorBoundary;
    const retry = vi.fn(async () => undefined);
    await render(<Fallback error={new Error(CRASH_MESSAGE)} retry={retry} />);

    for (const line of FALLBACK_EN) expect(text()).toContain(line);
    await press("Try again");
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the error itself stays out of sight (#308)", () => {
  it("neither fallback shows or logs the error's message", async () => {
    const printed: unknown[][] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        printed.push(args);
      }),
    );

    crash.tab = new TypeError(CRASH_MESSAGE);
    await render(<Route module={TabsRoute} />);
    expect(text()).toContain("Something glitched");
    act(() => root.unmount());
    root = createRoot(container, { onCaughtError: () => undefined });
    crash.rootProvider = true;
    await render(<Route module={RootLayoutRoute} />);
    expect(text()).toContain("Something glitched");

    expect(text()).not.toContain("ana@example.com");
    for (const spy of spies) spy.mockRestore();
    expect(JSON.stringify(printed.map((args) => args.map(String)))).not.toContain("ana@example.com");
  });
});
