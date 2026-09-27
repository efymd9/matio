/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ContinueResponse, EpisodeProgressResponse, ShowDetail } from "@/shared/api-types";

// #303 items 2 and 3 — where the player screen opens an episode.
//
// Item 2: the position used to come from a search of /v1/continue, which
// carries ONE episode per show — so any other partly watched episode opened
// at 0:00 and its place was overwritten by the next save. It now comes from
// GET /v1/progress for that very episode.
// Item 3: the lookup is best-effort and must not hold the player behind a
// spinner — it is bounded at 2.5s, after which the episode opens at 0:00.
//
// Rendered for real in jsdom on react-native-web; the router, the API and
// the feed are faked, and the feed's props are what the screen decided.
// (Not under app/ — a test file there would become an expo-router route.)

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

let params: Record<string, string | undefined> = {};
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => params,
}));

const NEVER = () => new Promise<never>(() => {});
const fake = vi.hoisted(() => ({
  signedIn: true,
  episodeProgress: null as unknown as Mock<(episodeId: string) => Promise<EpisodeProgressResponse>>,
  continueWatching: null as unknown as Mock<() => Promise<ContinueResponse>>,
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      show: async () => SHOW,
      continueWatching: () => fake.continueWatching(),
      episodeProgress: (episodeId: string) => fake.episodeProgress(episodeId),
    },
  };
});
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => ({
    isLoaded: true,
    isSignedIn: fake.signedIn,
    stalled: false,
    retry: () => undefined,
  }),
}));
type FeedProps = { initialIndex: number; resumeSeconds: number };
const feed = vi.hoisted(() => ({ props: null as null | FeedProps }));
vi.mock("@/orientation", () => ({
  useOrientationLock: () => null,
  useOrientationSettled: () => true,
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
import WatchScreen from "@/app/watch/[episodeId]";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const episode = (n: number): ShowDetail["episodes"][number] => ({
  id: `ep${n}`,
  seasonNumber: 1,
  number: n,
  title: `Episode ${n}`,
  description: null,
  durationSeconds: 600,
  access: "free",
  releasedAt: null,
  thumbnailUrl: null,
  introStartSeconds: null,
  introEndSeconds: null,
});

const SHOW: ShowDetail = {
  id: "show-1",
  slug: "the-scarlet-oath",
  title: "The Scarlet Oath",
  synopsis: null,
  genre: [],
  orientation: "horizontal",
  posterImageUrl: null,
  heroImageUrl: null,
  episodeCount: 4,
  featured: false,
  justReleased: false,
  popularNow: false,
  episodes: [episode(1), episode(2), episode(3), episode(4)],
};

// The continue rail for this show names ep 4 — the episode watched last.
const RAIL: ContinueResponse = {
  items: [
    {
      show: {
        slug: SHOW.slug,
        title: SHOW.title,
        orientation: "horizontal",
        posterImageUrl: null,
        heroImageUrl: null,
      },
      episodeId: "ep4",
      episodeNumber: 4,
      episodeTitle: "Episode 4",
      positionSeconds: 100,
      durationSeconds: 600,
      fraction: 100 / 600,
      updatedAt: "2026-09-27T10:00:00.000Z",
    },
  ],
};

// Each episode's own saved position.
const SAVED: Record<string, number> = { ep3: 240, ep4: 100 };

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactNode) {
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const mounted = () => {
  if (!feed.props) throw new Error("the feed is not mounted");
  return feed.props;
};

beforeEach(() => {
  params = { episodeId: "ep3", showSlug: SHOW.slug };
  fake.signedIn = true;
  fake.continueWatching = vi.fn(async () => RAIL);
  fake.episodeProgress = vi.fn(
    async (id: string): Promise<EpisodeProgressResponse> => ({ positionSeconds: SAVED[id] ?? 0 }),
  );
  feed.props = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("the player screen opens an episode at its own saved position (#303 item 2)", () => {
  it("resumes ep 3 at ITS position, although ep 4 is the one on the continue rail", async () => {
    await render(<WatchScreen />);

    expect(fake.episodeProgress).toHaveBeenCalledWith("ep3");
    expect(mounted()).toMatchObject({ initialIndex: 2, resumeSeconds: 240 });
  });

  it("an explicit `resume` (the rail's tap) still wins — and nothing is looked up", async () => {
    params = { episodeId: "ep4", showSlug: SHOW.slug, resume: "120" };
    await render(<WatchScreen />);

    expect(fake.episodeProgress).not.toHaveBeenCalled();
    expect(mounted()).toMatchObject({ initialIndex: 3, resumeSeconds: 120 });
  });

  it("a signed-out viewer has no row to read: 0, and no request", async () => {
    fake.signedIn = false;
    await render(<WatchScreen />);

    expect(fake.episodeProgress).not.toHaveBeenCalled();
    expect(mounted()).toMatchObject({ initialIndex: 2, resumeSeconds: 0 });
  });

  it("a failed lookup costs only the resume: the episode opens at 0:00", async () => {
    fake.episodeProgress.mockRejectedValue(new Error("offline"));
    await render(<WatchScreen />);

    expect(mounted()).toMatchObject({ initialIndex: 2, resumeSeconds: 0 });
  });
});

describe("the player screen does not wait on the lookup (#303 item 3)", () => {
  it("a lookup that never answers holds the player 2.5s at most, then it opens at 0:00", async () => {
    vi.useFakeTimers();
    fake.episodeProgress.mockImplementation(NEVER);
    fake.continueWatching.mockImplementation(NEVER);

    await act(async () => {
      root.render(<WatchScreen />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(feed.props).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mounted()).toMatchObject({ initialIndex: 2, resumeSeconds: 0 });
  });

  it("the 2.5s ceiling covers the fallback too: a 405 at once, then a rail that never answers", async () => {
    vi.useFakeTimers();
    fake.episodeProgress.mockRejectedValue(new ApiError("server_error", "Request failed (405).", 405));
    fake.continueWatching.mockImplementation(NEVER);

    await act(async () => {
      root.render(<WatchScreen />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_499);
    });
    expect(fake.continueWatching).toHaveBeenCalledTimes(1);
    expect(feed.props).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mounted()).toMatchObject({ initialIndex: 2, resumeSeconds: 0 });
  });
});

// Review of #333: production answers 405 on GET /v1/progress until the
// release that ships it, and a TestFlight build cut from main before that
// would open every episode at 0:00 — then its first save overwrites the
// stored place. Such a server gets the pre-#303 lookup: the rail's row for
// THIS episode.
describe("a server that does not serve the per-episode read yet (#333 review)", () => {
  it.each([405, 404])("a %i falls back to the continue rail's row for this episode", async (status) => {
    params = { episodeId: "ep4", showSlug: SHOW.slug };
    fake.episodeProgress.mockRejectedValue(
      new ApiError("server_error", `Request failed (${status}).`, status),
    );
    await render(<WatchScreen />);

    expect(fake.continueWatching).toHaveBeenCalledTimes(1);
    expect(mounted()).toMatchObject({ initialIndex: 3, resumeSeconds: 100 });
  });

  it("an episode the rail does not carry opens at 0:00 there, as before #303", async () => {
    fake.episodeProgress.mockRejectedValue(new ApiError("server_error", "Request failed (405).", 405));
    await render(<WatchScreen />);

    expect(mounted()).toMatchObject({ initialIndex: 2, resumeSeconds: 0 });
  });

  it("any other failure is not a missing route: no fallback, the episode opens at 0:00", async () => {
    params = { episodeId: "ep4", showSlug: SHOW.slug };
    for (const err of [
      new ApiError("network", "The request timed out.", 0),
      new ApiError("unauthorized", "Sign in to resume where you left off.", 401),
      new ApiError("server_error", "Request failed (500).", 500),
    ]) {
      fake.episodeProgress.mockRejectedValueOnce(err);
      feed.props = null;
      await render(<WatchScreen key={err.status} />);
      expect(mounted(), String(err.status)).toMatchObject({ initialIndex: 3, resumeSeconds: 0 });
    }
    expect(fake.continueWatching).not.toHaveBeenCalled();
  });
});
