/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, ShowDetail } from "@/shared/api-types";

// #292 item 1 — the show page and the player are screens of the root stack,
// pushed over the tabs. When they fail to load there is no «‹» over the
// error, and testers do not find the iOS edge swipe: every such state now
// has a visible «Back» — next to «Try again» where a retry can help, alone
// where it cannot — leading to the previous screen, or Home when there is
// none (goBackOrHome). Also item 6: the show page's Play is the one gold
// button on it that carries ▶. Rendered for real in jsdom on
// react-native-web; the router, the API and the player are faked. (Not under
// app/ — a test file there would become an expo-router route.)

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
vi.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => params,
  // The player's own options (#358: no edge swipe on the landscape player).
  Stack: { Screen: () => null },
}));

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
  useConfig: (): Partial<AppConfig> => ({ signupGate: { mode: "tiers" } }),
}));
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => ({ isLoaded: true, isSignedIn: false, stalled: false, retry: () => undefined }),
}));
// The player's orientation lock and the feed itself are not under test: the
// errors come before either. The #302 cases settle the screen and read what
// it hands the feed.
type FeedProps = {
  initialIndex: number;
  resumeSeconds: number;
  onCurrentChange: (index: number, positionSeconds: number) => void;
};
const feed = vi.hoisted(() => ({ settled: false, props: null as null | FeedProps }));
vi.mock("@/orientation", () => ({
  useOrientationLock: () => null,
  useOrientationSettled: () => feed.settled,
  // The leave's upright turn (#358) is pinned in watch-back.test.tsx; here
  // «Back» is the pop itself.
  useLeaveUpright: (leave: () => void) => ({ leaving: false, requestLeave: leave }),
}));
vi.mock("@/watch/episode-feed", () => ({
  EpisodeFeed: (props: FeedProps) => {
    feed.props = props;
    return null;
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

import { ApiError } from "@/api/client";
import ShowScreen from "@/app/show/[slug]";
import WatchScreen from "@/app/watch/[episodeId]";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const fail = (error: ApiError) => async () => {
  throw error;
};

beforeEach(() => {
  for (const fn of [router.push, router.replace, router.back]) fn.mockClear();
  router.canGoBack.mockReset().mockReturnValue(true);
  params = {};
  show.answer = async () => SHOW;
  feed.settled = false;
  feed.props = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the show page (#292 item 1)", () => {
  beforeEach(() => {
    params = { slug: "the-scarlet-oath" };
  });

  it("«Not found» is no longer a dead end: «Back», and no retry", async () => {
    show.answer = fail(new ApiError("not_found", "Show not found.", 404));
    await render(<ShowScreen />);

    expect(text()).toContain("Not found");
    expect(text()).not.toContain("Try again");
    press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("a failed load offers «Back» next to «Try again»", async () => {
    show.answer = fail(new ApiError("network", "The request timed out.", 0));
    await render(<ShowScreen />);

    expect(text()).toContain("Try again");
    press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("with nothing under it (a cold start from a link), «Back» goes Home", async () => {
    router.canGoBack.mockReturnValue(false);
    show.answer = fail(new ApiError("not_found", "Show not found.", 404));
    await render(<ShowScreen />);

    press("Back");
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("its Play is a play button — the ▶ is on it (#292 item 6)", async () => {
    await render(<ShowScreen />);

    const glyphs = container.querySelectorAll('[data-testid="play-glyph"]');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].closest('[role="button"]')?.textContent).toBe("Play · Ep. 1");
  });
});

describe("the player screen (#292 item 1)", () => {
  beforeEach(() => {
    params = { episodeId: "ep1", showSlug: "the-scarlet-oath" };
  });

  it("a show that would not load offers «Back» next to «Try again»", async () => {
    show.answer = fail(new ApiError("server_error", "boom", 500));
    await render(<WatchScreen />);

    expect(text()).toContain("Couldn't load this show");
    expect(text()).toContain("Try again");
    press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("«Episode unavailable» — an episode gone from the show — has «Back» and nothing to retry", async () => {
    params = { episodeId: "ep-gone", showSlug: "the-scarlet-oath" };
    await render(<WatchScreen />);

    expect(text()).toContain("Playback unavailable");
    expect(text()).not.toContain("Try again");
    press("Back");
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

// #302 item 3 — the feed is taken down while another screen covers the
// player (useOrientationSettled) and comes back on the page the viewer left;
// now also at the playhead they left it, never at a stale deep-link resume.
describe("the player screen brings the feed back where the viewer was (#302 item 3)", () => {
  const TWO_EPISODES: ShowDetail = {
    ...SHOW,
    episodeCount: 2,
    episodes: [SHOW.episodes[0], { ...SHOW.episodes[0], id: "ep2", number: 2, title: "Episode 2" }],
  };

  beforeEach(() => {
    params = { episodeId: "ep1", showSlug: "the-scarlet-oath", resume: "120" };
    show.answer = async () => TWO_EPISODES;
    feed.settled = true;
  });

  const mounted = () => {
    if (!feed.props) throw new Error("the feed is not mounted");
    return feed.props;
  };

  // A screen pushed over the player and popped again.
  async function coverAndReturn() {
    feed.settled = false;
    await render(<WatchScreen />);
    feed.props = null;
    feed.settled = true;
    await render(<WatchScreen />);
    return mounted();
  }

  it("opens on the deep link's episode, at its resume", async () => {
    await render(<WatchScreen />);
    expect(mounted()).toMatchObject({ initialIndex: 0, resumeSeconds: 120 });
  });

  it("comes back on the page the viewer left, at its playhead", async () => {
    await render(<WatchScreen />);
    mounted().onCurrentChange(1, 250);

    expect(await coverAndReturn()).toMatchObject({ initialIndex: 1, resumeSeconds: 250 });
  });

  it("on the deep-linked page itself, at the viewer's playhead — not back at the stale resume", async () => {
    await render(<WatchScreen />);
    mounted().onCurrentChange(0, 400);

    expect(await coverAndReturn()).toMatchObject({ initialIndex: 0, resumeSeconds: 400 });
  });

  it("an episode that ended (0) reopens at the start — 0 is a position, not a gap for the deep link to fill", async () => {
    await render(<WatchScreen />);
    mounted().onCurrentChange(0, 0);

    expect(await coverAndReturn()).toMatchObject({ initialIndex: 0, resumeSeconds: 0 });
  });
});
