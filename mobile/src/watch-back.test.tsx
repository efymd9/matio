/** @vitest-environment jsdom */
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShowDetail } from "@/shared/api-types";

// #358 — «‹» from the LANDSCAPE player froze the app (TestFlight 0.1.0 (7)):
// the screen popped at once, its unmount asked for portrait in the middle of
// the native pop, and the rotation stranded the transition — a stretched
// landscape snapshot over a window that no longer took touches. The watch
// screen now turns upright FIRST (the feed down, portrait asked for while it
// is still focused) and pops only once that rotation has finished; and the
// iOS edge swipe — a pop that asks nobody — is off on the landscape player.
//
// Rendered for real in jsdom on react-native-web, with the REAL orientation
// module: the native lock is the spy below, the window is jsdom's, and the
// router, the API, Clerk and the feed are faked. (Not under app/ — a test
// file there would become an expo-router route.)

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
// What the screen set as its own options (`<Stack.Screen options>`).
const screen = vi.hoisted(() => ({ options: undefined as undefined | Record<string, unknown> }));
vi.mock("expo-router", async () => {
  const { useEffect: useEffectInMock } = await import("react");
  return {
    useRouter: () => router,
    useLocalSearchParams: () => params,
    // The screen is focused from mount to unmount — what useFocusEffect does
    // for a screen nothing is pushed over.
    useFocusEffect: (effect: () => void | (() => void)) => {
      useEffectInMock(() => effect(), [effect]);
    },
    Stack: {
      Screen: ({ options }: { options?: Record<string, unknown> }) => {
        screen.options = options;
        return null;
      },
    },
  };
});

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
// Signed out: no resume lookup — the screen opens as soon as the show is in.
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => ({ isLoaded: true, isSignedIn: false, stalled: false, retry: () => undefined }),
}));

// The feed stands in for the player: its «‹» is `onBack`, and whether it is
// mounted is whether the native video view is.
type FeedProps = { onBack: () => void };
const feed = vi.hoisted(() => ({ props: null as null | FeedProps, mounted: false }));
vi.mock("@/watch/episode-feed", () => ({
  EpisodeFeed: (props: FeedProps) => {
    feed.props = props;
    useEffect(() => {
      feed.mounted = true;
      return () => {
        feed.mounted = false;
      };
    }, []);
    return null;
  },
}));

// The native lock is a spy; the end of a rotation — the event the root view
// controller sends from its transition coordinator's completion — is fired
// by `turnUpright` below.
const orientation = vi.hoisted(() => ({
  PORTRAIT_UP: 1,
  LANDSCAPE: 2,
  lockAsync: vi.fn(async (_lock: number) => undefined),
  listeners: new Set<(event: { orientationInfo: { orientation: number } }) => void>(),
}));
const ROTATED_PORTRAIT_UP = 1; // expo-screen-orientation's Orientation.PORTRAIT_UP
vi.mock("expo-screen-orientation", () => ({
  OrientationLock: { PORTRAIT_UP: orientation.PORTRAIT_UP, LANDSCAPE: orientation.LANDSCAPE },
  Orientation: { UNKNOWN: 0, PORTRAIT_UP: 1, PORTRAIT_DOWN: 2, LANDSCAPE_LEFT: 3, LANDSCAPE_RIGHT: 4 },
  lockAsync: orientation.lockAsync,
  addOrientationChangeListener(listener: (event: { orientationInfo: { orientation: number } }) => void) {
    orientation.listeners.add(listener);
    return { remove: () => orientation.listeners.delete(listener) };
  },
}));

vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
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
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import WatchScreen from "@/app/watch/[episodeId]";
import { resetOrientationLockForTests } from "@/orientation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const episode = {
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
} satisfies ShowDetail["episodes"][number];

const showOf = (orientation: ShowDetail["orientation"]): ShowDetail => ({
  id: "show-1",
  slug: "into-the-dark",
  title: "Into the Dark",
  synopsis: null,
  genre: [],
  orientation,
  posterImageUrl: null,
  heroImageUrl: null,
  episodeCount: 1,
  featured: false,
  justReleased: false,
  popularNow: false,
  episodes: [episode],
});

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactNode) {
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function press(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// The window react-native-web's useWindowDimensions reads: jsdom has no
// visualViewport and no layout, so RNW falls back to documentElement's
// client size — defined here, then the `resize` RNW listens to.
function setWindow(width: number, height: number) {
  const docEl = document.documentElement;
  Object.defineProperty(docEl, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(docEl, "clientHeight", { configurable: true, get: () => height });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

const LOCK_NAMES: Record<number, string> = {
  [orientation.PORTRAIT_UP]: "PORTRAIT_UP",
  [orientation.LANDSCAPE]: "LANDSCAPE",
};
const locks = () => orientation.lockAsync.mock.calls.map(([lock]) => LOCK_NAMES[lock] ?? String(lock));

// The phone has turned upright: the window's portrait size (reported as the
// rotation begins), then the end of the rotation.
function turnUpright() {
  setWindow(390, 844);
  act(() => {
    orientation.listeners.forEach((listener) =>
      listener({ orientationInfo: { orientation: ROTATED_PORTRAIT_UP } }),
    );
  });
}

// The pop itself: the route leaves the tree. Whatever the device hears from
// here on, it hears during the native transition.
function pop() {
  act(() => root.unmount());
  root = createRoot(container);
}

beforeEach(() => {
  for (const fn of [router.push, router.replace, router.back]) fn.mockClear();
  router.canGoBack.mockReset().mockReturnValue(true);
  resetOrientationLockForTests();
  orientation.lockAsync.mockClear();
  orientation.listeners.clear();
  params = { episodeId: "ep1", showSlug: "into-the-dark" };
  show.answer = async () => showOf("horizontal");
  screen.options = undefined;
  feed.props = null;
  feed.mounted = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Back from the landscape player turns upright before it pops (#358)", () => {
  it("«‹»: the feed comes down and portrait is asked for while the screen is still up; the pop waits for the rotation", async () => {
    setWindow(844, 390);
    await render(<WatchScreen />);
    expect(feed.mounted).toBe(true);
    expect(locks()).toEqual(["LANDSCAPE"]);

    act(() => feed.props!.onBack());
    // Nothing popped yet: the player is down, the phone is turning upright.
    expect(router.back).not.toHaveBeenCalled();
    expect(feed.mounted).toBe(false);
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);

    // The window reports its portrait size as the rotation BEGINS: not yet.
    setWindow(390, 844);
    expect(router.back).not.toHaveBeenCalled();

    // The rotation is over: now the pop — once.
    turnUpright();
    expect(router.back).toHaveBeenCalledTimes(1);

    // And the pop's unmount has nothing left to ask of the device.
    pop();
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("«Episode unavailable» on a landscape show: its «Back» waits for the upright turn too", async () => {
    params = { episodeId: "ep-gone", showSlug: "into-the-dark" };
    setWindow(844, 390);
    await render(<WatchScreen />);
    expect(locks()).toEqual(["LANDSCAPE"]);

    press("Back");
    expect(router.back).not.toHaveBeenCalled();
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);

    turnUpright();
    expect(router.back).toHaveBeenCalledTimes(1);
    pop();
    expect(locks()).toEqual(["LANDSCAPE", "PORTRAIT_UP"]);
  });

  it("the edge swipe is off on the landscape player — it would pop without the upright turn", async () => {
    setWindow(844, 390);
    await render(<WatchScreen />);
    expect(screen.options).toEqual({ gestureEnabled: false });
  });
});

describe("where nothing has to turn, Back pops at once (#358)", () => {
  it("a vertical show: one tap, one pop — no landscape, no second portrait request; its swipe stays", async () => {
    show.answer = async () => showOf("vertical");
    setWindow(390, 844);
    await render(<WatchScreen />);
    expect(feed.mounted).toBe(true);
    expect(screen.options).toEqual({ gestureEnabled: true });

    act(() => feed.props!.onBack());
    expect(router.back).toHaveBeenCalledTimes(1);
    pop();
    expect(locks()).toEqual(["PORTRAIT_UP"]);
  });

  it("a show that never loaded took no lock: «Back» pops at once, and nothing reaches the device", async () => {
    show.answer = async () => {
      throw new Error("offline");
    };
    setWindow(390, 844);
    await render(<WatchScreen />);

    press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
    pop();
    expect(orientation.lockAsync).not.toHaveBeenCalled();
  });
});
