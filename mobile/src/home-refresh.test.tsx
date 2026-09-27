/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogResponse, ContinueResponse, ShowSummary } from "@/shared/api-types";

// #313 — pull-to-refresh on Home. The screen is rendered for real on
// react-native-web — CatalogProvider, useAsync and useContinueWatching
// included — and only the network, the router, auth and native modules are
// faked. A pull reloads the catalog AND Up next; the spinner (the system
// RefreshControl, tinted gold) stays until BOTH have settled; a failed reload
// keeps what is on screen and still clears the spinner; an anonymous viewer's
// pull asks for the catalog only. (Not under app/ — a test file there would
// become an expo-router route.)

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

// The RefreshControl the feed hands its list, as it was last rendered. The
// real react-native-web one still renders (it wraps the scroll view), but it
// drops the props this suite is about, so they are recorded on the way in.
type RefreshProps = {
  refreshing: boolean;
  onRefresh?: () => void;
  tintColor?: unknown;
  progressViewOffset?: number;
  children?: ReactNode;
};
const refresh = vi.hoisted(() => ({ props: null as RefreshProps | null }));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  function RefreshControl(props: RefreshProps) {
    refresh.props = props;
    return createElement(rn.RefreshControl as never, props);
  }
  return { ...rn, RefreshControl };
});

// The carousel's UI-thread animation has no web runtime here; a plain
// FlatList and inert shared values are all Home needs to render.
vi.mock("react-native-reanimated", async () => {
  const rn = await import("react-native");
  return {
    default: { FlatList: rn.FlatList, View: rn.View },
    interpolate: () => 1,
    useAnimatedScrollHandler: () => undefined,
    useAnimatedStyle: () => ({}),
    useSharedValue: (value: number) => ({ value }),
  };
});

// Home is the focused tab for the whole suite.
vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useFocusEffect(effect: () => undefined | (() => void)) {
      React.useEffect(() => effect(), [effect]);
    },
  };
});

const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => ({
    isLoaded: true,
    isSignedIn: auth.signedIn,
    stalled: false,
    retry: () => undefined,
  }),
}));
vi.mock("@/watch/first-episode", () => ({
  usePlayFirstEpisode: () => ({ play: vi.fn(), busy: false }),
}));
vi.mock("@/watch/use-progress-saver", () => ({ onProgressSaved: () => () => undefined }));
vi.mock("@/components/glass-tab-bar", () => ({ useTabBarClearance: () => 0 }));

// GET /v1/catalog and /v1/continue under the case's control: each call hands
// back a promise the case resolves or rejects when it chooses.
type Pending<T> = { resolve: (value: T) => void; reject: (e: unknown) => void };
const net = vi.hoisted(() => ({
  catalog: [] as Array<Pending<CatalogResponse>>,
  resume: [] as Array<Pending<ContinueResponse>>,
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      catalog: () =>
        new Promise<CatalogResponse>((resolve, reject) => {
          net.catalog.push({ resolve, reject });
        }),
      continueWatching: () =>
        new Promise<ContinueResponse>((resolve, reject) => {
          net.resume.push({ resolve, reject });
        }),
    },
  };
});

// The notch / Dynamic Island the list runs under.
const TOP_INSET = 59;
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: { children?: ReactNode }) => children ?? null,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));

import { CatalogProvider } from "@/api/catalog-context";
import HomeScreen from "@/app/(tabs)/index";
import { appDictFor } from "@/shared/i18n";
import { colors } from "@/theme";

function show(slug: string, title: string): ShowSummary {
  return {
    id: slug,
    slug,
    title,
    synopsis: null,
    genre: [],
    orientation: "horizontal",
    posterImageUrl: null,
    heroImageUrl: null,
    episodeCount: 3,
    featured: false,
    justReleased: false,
    popularNow: false,
  };
}

const catalogOf = (...shows: ShowSummary[]): CatalogResponse => ({ shows });

function resumeOf(slug: string, title: string): ContinueResponse {
  return {
    items: [
      {
        show: { slug, title, orientation: "horizontal", posterImageUrl: null, heroImageUrl: null },
        episodeId: `${slug}-ep2`,
        episodeNumber: 2,
        episodeTitle: "The Letter",
        positionSeconds: 300,
        durationSeconds: 1200,
        fraction: 0.25,
        updatedAt: "2026-09-27T10:00:00.000Z",
      },
    ],
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Home on screen with a first catalog (and, signed in, a first Up next).
async function mountHome() {
  act(() =>
    root.render(
      <CatalogProvider>
        <HomeScreen />
      </CatalogProvider>,
    ),
  );
  await settle();
  net.catalog[0].resolve(catalogOf(show("fallen", "Fallen"), show("morelli", "Morelli")));
  if (auth.signedIn) net.resume[0].resolve(resumeOf("second-hand", "Second Hand"));
  await settle();
  expect(text()).toContain("Morelli");
}

function pull() {
  const onRefresh = refresh.props?.onRefresh;
  if (!onRefresh) throw new Error("Home's list has no pull-to-refresh");
  act(() => onRefresh());
}

const spinning = () => refresh.props?.refreshing;

beforeEach(() => {
  auth.signedIn = true;
  refresh.props = null;
  net.catalog.length = 0;
  net.resume.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Home pull-to-refresh (#313)", () => {
  it("is the system control in the theme's gold, pushed below the status bar", async () => {
    await mountHome();

    expect(refresh.props?.tintColor).toBe(colors.gold);
    expect(refresh.props?.progressViewOffset).toBe(TOP_INSET);
    expect(spinning()).toBe(false);
  });

  it("a pull reloads the catalog and Up next, and the spinner stays until both have settled", async () => {
    await mountHome();
    expect(text()).toContain("Second Hand");

    pull();
    expect(net.catalog).toHaveLength(2);
    expect(net.resume).toHaveLength(2);
    await settle();
    expect(spinning()).toBe(true);

    net.catalog[1].resolve(
      catalogOf(show("fallen", "Fallen"), show("morelli", "Morelli"), show("new-show", "New Show")),
    );
    await settle();
    expect(text()).toContain("New Show");
    expect(spinning()).toBe(true);

    net.resume[1].resolve(resumeOf("quedate-conmigo", "Quédate conmigo"));
    await settle();
    expect(spinning()).toBe(false);
    expect(text()).toContain("Quédate conmigo");
  });

  it("the spinner waits for the catalog too when Up next answers first", async () => {
    await mountHome();

    pull();
    net.resume[1].resolve(resumeOf("second-hand", "Second Hand"));
    await settle();
    expect(spinning()).toBe(true);

    net.catalog[1].resolve(catalogOf(show("fallen", "Fallen")));
    await settle();
    expect(spinning()).toBe(false);
  });

  it("a failed reload keeps the feed on screen and still clears the spinner", async () => {
    await mountHome();

    pull();
    net.catalog[1].reject(new Error("network"));
    await settle();
    expect(spinning()).toBe(true);

    net.resume[1].reject(new Error("network"));
    await settle();

    expect(spinning()).toBe(false);
    expect(text()).toContain("Fallen");
    expect(text()).toContain("Morelli");
    expect(text()).toContain("Second Hand");
    // No drop back to the error screen or the spinner of a first load.
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text()).not.toContain(appDictFor("en").common.loadFailed);
  });

  it("an anonymous pull reloads the catalog only, and the spinner clears when it settles", async () => {
    auth.signedIn = false;
    await mountHome();
    expect(net.resume).toHaveLength(0);

    pull();
    expect(net.catalog).toHaveLength(2);
    expect(net.resume).toHaveLength(0);
    await settle();
    expect(spinning()).toBe(true);

    net.catalog[1].resolve(catalogOf(show("fallen", "Fallen"), show("new-show", "New Show")));
    await settle();

    expect(spinning()).toBe(false);
    expect(text()).toContain("New Show");
  });
});
