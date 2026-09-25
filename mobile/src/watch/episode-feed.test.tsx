/** @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppConfig,
  EpisodeAccessTier,
  PlaybackTokenResponse,
  ShowDetail,
  ShowOrientation,
  SignupGate,
} from "@/shared/api-types";

// The episode feed — the app's one player engine — rendered for real in jsdom
// on react-native-web: FlatList, pages, walls, error states. What is faked is
// the edge of the world: the native <Video> (a stub that records its props
// and exposes seek), the token route, the config, and — for the vertical
// cases — the chrome, reduced to the `paused` it is handed.

type VideoProps = {
  source: { uri: string };
  paused: boolean;
  onLoad?: (e: { duration: number }) => void;
  onProgress?: (e: { currentTime: number }) => void;
  onEnd?: () => void;
  onError?: () => void;
  onBuffer?: (e: { isBuffering: boolean }) => void;
  onPlaybackStateChanged?: (e: { isPlaying: boolean; isSeeking: boolean }) => void;
  onAudioBecomingNoisy?: () => void;
};
type VideoInstance = { props: VideoProps; seek: ReturnType<typeof vi.fn> };

// React Native's global, read by the api client at module load — which the
// imports below reach before any beforeEach runs.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

const h = vi.hoisted(() => ({
  videos: new Map<string, { props: unknown; seek: unknown }>(),
  mounts: [] as string[],
  chrome: new Map<string, { paused: boolean; onTogglePlay: () => void }>(),
  // The feed list's props: its viewability callback is how a SWIPE changes
  // the page, and jsdom has no layout to fire it — a case calls it directly.
  list: null as null | {
    viewabilityConfigCallbackPairs?: Array<{
      onViewableItemsChanged: (info: { viewableItems: Array<{ index: number }> }) => void;
    }>;
  },
}));

vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  const React = await import("react");
  const FlatList = React.forwardRef(function FlatList(props: object, ref) {
    h.list = props;
    return React.createElement(rn.FlatList as never, { ...props, ref });
  });
  return { ...rn, FlatList };
});

vi.mock("react-native-video", async () => {
  const React = await import("react");
  const { vi: vitest } = await import("vitest");
  const Video = React.forwardRef(function Video(props: VideoProps, ref) {
    const seek = React.useRef(vitest.fn()).current;
    React.useImperativeHandle(ref, () => ({ seek }));
    React.useEffect(() => {
      h.mounts.push(props.source.uri);
    }, [props.source.uri]);
    h.videos.set(props.source.uri, { props, seek });
    return React.createElement("div", { "data-video": props.source.uri });
  });
  return { default: Video };
});

// The vertical chrome, reduced to what the feed decides for it.
vi.mock("@/components/vertical-chrome", () => ({
  VerticalChrome: (props: { episodeTitle: string; paused: boolean; onTogglePlay: () => void }) => {
    h.chrome.set(props.episodeTitle, props);
    return null;
  },
}));

const tokens = vi.hoisted(() => ({
  calls: [] as string[],
  answer: (() => undefined) as unknown as (episodeId: string) => Promise<PlaybackTokenResponse>,
}));
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      playbackToken: (episodeId: string) => {
        tokens.calls.push(episodeId);
        return tokens.answer(episodeId);
      },
      saveProgress: async () => ({ ok: true }),
      saveWatchSegments: async () => ({ ok: true, accepted: 0 }),
    },
  };
});

let gate: SignupGate = { mode: "tiers" };
vi.mock("@/api/config-context", () => ({
  useConfig: (): Partial<AppConfig> => ({ signupGate: gate }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
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
import { EpisodeFeed } from "./episode-feed";

function makeShow(
  orientation: ShowOrientation,
  access: EpisodeAccessTier[],
): ShowDetail {
  return {
    id: "show-1",
    slug: "the-scarlet-oath",
    title: "The Scarlet Oath",
    synopsis: null,
    genre: [],
    orientation,
    posterImageUrl: null,
    heroImageUrl: null,
    episodeCount: access.length,
    featured: false,
    justReleased: false,
    popularNow: false,
    episodes: access.map((tier, i) => ({
      id: `ep${i + 1}`,
      seasonNumber: 1,
      number: i + 1,
      title: `Episode ${i + 1}`,
      description: null,
      durationSeconds: 600,
      access: tier,
      releasedAt: null,
      thumbnailUrl: null,
      introStartSeconds: null,
      introEndSeconds: null,
    })),
  };
}

const granted = (episodeId: string, n = 1): PlaybackTokenResponse => ({
  playbackId: `pb-${episodeId}`,
  token: `tok-${episodeId}-${n}`,
  expiresIn: 3600,
  mode: "member",
});

// The stream URL a granted token becomes (muxStreamUrl).
const uri = (episodeId: string, n = 1) =>
  `https://stream.mux.com/pb-${episodeId}.m3u8?token=tok-${episodeId}-${n}`;

function video(episodeId: string, n = 1): VideoInstance {
  const v = h.videos.get(uri(episodeId, n));
  if (!v) throw new Error(`no player for ${episodeId} (#${n}); have ${[...h.videos.keys()].join(", ")}`);
  return v as VideoInstance;
}

// react-native-web reads the window from documentElement (jsdom has no
// layout): a phone-sized portrait window for the feed's page height.
function setWindow(width: number, height: number) {
  const docEl = document.documentElement;
  Object.defineProperty(docEl, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(docEl, "clientHeight", { configurable: true, get: () => height });
  window.dispatchEvent(new Event("resize"));
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onSignIn = vi.fn();
const onBack = vi.fn();

const text = () => container.textContent ?? "";

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderFeed(show: ShowDetail, { signedIn = false, initialIndex = 0, resumeSeconds = 0 } = {}) {
  act(() =>
    root.render(
      <EpisodeFeed
        show={show}
        initialIndex={initialIndex}
        resumeSeconds={resumeSeconds}
        signedIn={signedIn}
        onBack={onBack}
        onSignIn={onSignIn}
      />,
    ),
  );
  await flush();
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

beforeEach(() => {
  vi.stubGlobal("__DEV__", false);
  setWindow(390, 844);
  h.videos.clear();
  h.mounts.length = 0;
  h.chrome.clear();
  tokens.calls.length = 0;
  tokens.answer = async (episodeId) => granted(episodeId);
  gate = { mode: "tiers" };
  onSignIn.mockClear();
  onBack.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const WALL_CTA = "Create free account";
const SUBSCRIBERS_ONLY = "Subscribers only";
const TRY_AGAIN = "Try again";

describe("EpisodeFeed — which answer a locked page gives (#288 item 1)", () => {
  it("plays an open episode", async () => {
    await renderFeed(makeShow("horizontal", ["free", "free"]));
    expect(tokens.calls).toEqual(["ep1"]);
    expect(video("ep1").props.paused).toBe(false);
  });

  it("a subscribers-only page tells a SIGNED-IN viewer so — no sign-up wall, no retry, no token asked", async () => {
    await renderFeed(makeShow("horizontal", ["free", "member", "subscriber"]), {
      signedIn: true,
      initialIndex: 2,
    });

    expect(text()).toContain(SUBSCRIBERS_ONLY);
    expect(text()).toContain("This episode needs an active subscription.");
    expect(text()).not.toContain(WALL_CTA);
    expect(text()).not.toContain("No card needed");
    expect(text()).not.toContain(TRY_AGAIN);
    expect(tokens.calls).not.toContain("ep3");
  });

  it("an anonymous viewer on a subscribers-only page is not sent round a sign-up loop", async () => {
    await renderFeed(makeShow("horizontal", ["subscriber"]));

    expect(text()).toContain(SUBSCRIBERS_ONLY);
    expect(text()).not.toContain(WALL_CTA);
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("an episode that asks for an account is still the sign-up wall for an anonymous viewer", async () => {
    await renderFeed(makeShow("horizontal", ["member"]));

    expect(text()).toContain(WALL_CTA);
    expect(text()).not.toContain(SUBSCRIBERS_ONLY);
    press(WALL_CTA);
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(tokens.calls).toEqual([]);
  });

  it("a member episode plays once signed in", async () => {
    await renderFeed(makeShow("horizontal", ["member"]), { signedIn: true });

    expect(text()).not.toContain(WALL_CTA);
    expect(video("ep1").props.paused).toBe(false);
  });
});

const SIGNUP_REQUIRED = () =>
  new ApiError("forbidden", "Sign in to keep watching.", 403, "signup_required");
const spinning = () => container.querySelector('[role="progressbar"]') !== null;

describe("EpisodeFeed — a signed-in viewer answered signup_required (#288 item 4)", () => {
  it("retries once, quietly, and plays when the late session makes it", async () => {
    vi.useFakeTimers();
    let n = 0;
    tokens.answer = async (episodeId) => {
      n += 1;
      if (n === 1) throw SIGNUP_REQUIRED();
      return granted(episodeId, n);
    };
    await renderFeed(makeShow("horizontal", ["member"]), { signedIn: true });

    // Not the wall: a spinner while the retry is pending.
    expect(text()).not.toContain(WALL_CTA);
    expect(spinning()).toBe(true);
    expect(tokens.calls).toEqual(["ep1"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(tokens.calls).toEqual(["ep1", "ep1"]);
    expect(video("ep1", 2).props.paused).toBe(false);
  });

  it("the same answer twice is an honest failure with a retry — never the wall", async () => {
    vi.useFakeTimers();
    tokens.answer = async () => {
      throw SIGNUP_REQUIRED();
    };
    await renderFeed(makeShow("horizontal", ["member"]), { signedIn: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(tokens.calls).toEqual(["ep1", "ep1"]);
    expect(text()).toContain("Playback unavailable");
    expect(text()).toContain(TRY_AGAIN);
    expect(text()).not.toContain(WALL_CTA);

    // Once per page: no third request on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(tokens.calls).toEqual(["ep1", "ep1"]);
  });

  it("a signed-out viewer gets the wall at once, with no retry", async () => {
    vi.useFakeTimers();
    // The client thinks the episode is open; the server says otherwise.
    gate = { mode: "none" };
    tokens.answer = async () => {
      throw SIGNUP_REQUIRED();
    };
    await renderFeed(makeShow("horizontal", ["member"]));

    expect(text()).toContain(WALL_CTA);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(tokens.calls).toEqual(["ep1"]);
  });
});

describe("EpisodeFeed — a token failure is told in the viewer's words (#288 item 7)", () => {
  it("a server failure shows the player's own line, never the server's English sentence", async () => {
    tokens.answer = async () => {
      throw new ApiError("server_error", "Your preview has ended.", 500);
    };
    await renderFeed(makeShow("horizontal", ["free"]));

    expect(text()).toContain("Playback unavailable");
    expect(text()).toContain("We couldn't load this episode.");
    expect(text()).not.toContain("Your preview has ended.");
  });

  it("an unreachable server reads as a connection problem", async () => {
    tokens.answer = async () => {
      throw new ApiError("network", "The request timed out.", 0);
    };
    await renderFeed(makeShow("horizontal", ["free"]));

    expect(text()).toContain("Check your connection and try again.");
    expect(text()).not.toContain("The request timed out.");
  });
});

describe("EpisodeFeed — Try again resumes where the viewer was (#288 item 5)", () => {
  it("after a playback failure mid-episode", async () => {
    let n = 0;
    tokens.answer = async (episodeId) => granted(episodeId, ++n);
    await renderFeed(makeShow("horizontal", ["free"]));

    const first = video("ep1", 1);
    act(() => first.props.onLoad?.({ duration: 600 }));
    act(() => first.props.onProgress?.({ currentTime: 300 }));
    act(() => first.props.onError?.());
    expect(text()).toContain("Playback unavailable");

    press(TRY_AGAIN);
    await flush();

    const second = video("ep1", 2);
    act(() => second.props.onLoad?.({ duration: 600 }));
    expect(second.seek).toHaveBeenCalledWith(300);
  });

  it("after a token refresh that gave up mid-episode", async () => {
    vi.useFakeTimers();
    let n = 0;
    tokens.answer = async (episodeId) => {
      n += 1;
      if (n === 2) throw new ApiError("rate_limited", "Too many requests.", 429);
      // 61s tokens: the refresh fires one second in.
      return { ...granted(episodeId, n), expiresIn: 61 };
    };
    await renderFeed(makeShow("horizontal", ["free"]));

    const first = video("ep1", 1);
    act(() => first.props.onLoad?.({ duration: 600 }));
    act(() => first.props.onProgress?.({ currentTime: 300 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(text()).toContain("Too many previews");

    press(TRY_AGAIN);
    await flush();

    const third = video("ep1", 3);
    act(() => third.props.onLoad?.({ duration: 600 }));
    expect(third.seek).toHaveBeenCalledWith(300);
  });

  it("a page that never played keeps its deep-link resume on retry", async () => {
    let n = 0;
    tokens.answer = async (episodeId) => {
      n += 1;
      if (n === 1) throw new ApiError("server_error", "Request failed (503).", 503);
      return granted(episodeId, n);
    };
    await renderFeed(makeShow("horizontal", ["free"]), { resumeSeconds: 120 });

    press(TRY_AGAIN);
    await flush();

    const player = video("ep1", 2);
    act(() => player.props.onLoad?.({ duration: 600 }));
    expect(player.seek).toHaveBeenCalledWith(120);
  });
});

describe("EpisodeFeed — the vertical player's pause follows the player (#288 item 9)", () => {
  const VERTICAL = () => makeShow("vertical", ["free", "free", "free"]);
  const chrome = (n: number) => {
    const c = h.chrome.get(`Episode ${n}`);
    if (!c) throw new Error(`no chrome for episode ${n}`);
    return c;
  };
  const swipeTo = (index: number) =>
    act(() =>
      h.list?.viewabilityConfigCallbackPairs?.[0].onViewableItemsChanged({
        viewableItems: [{ index }],
      }),
    );

  it("an OS pause (lock screen, Control Center, a call) shows as paused, and the first tap plays", async () => {
    await renderFeed(VERTICAL());
    expect(chrome(1).paused).toBe(false);

    act(() => video("ep1").props.onPlaybackStateChanged?.({ isPlaying: false, isSeeking: false }));
    expect(chrome(1).paused).toBe(true);
    expect(video("ep1").props.paused).toBe(true);

    act(() => chrome(1).onTogglePlay());
    expect(chrome(1).paused).toBe(false);
    expect(video("ep1").props.paused).toBe(false);
  });

  it("a play from the lock screen clears the pause as well", async () => {
    await renderFeed(VERTICAL());
    act(() => chrome(1).onTogglePlay());
    expect(chrome(1).paused).toBe(true);

    act(() => video("ep1").props.onPlaybackStateChanged?.({ isPlaying: true, isSeeking: false }));
    expect(chrome(1).paused).toBe(false);
  });

  it("a stall or a seek is not a pause", async () => {
    await renderFeed(VERTICAL());

    act(() => video("ep1").props.onPlaybackStateChanged?.({ isPlaying: false, isSeeking: true }));
    expect(chrome(1).paused).toBe(false);

    act(() => video("ep1").props.onBuffer?.({ isBuffering: true }));
    act(() => video("ep1").props.onPlaybackStateChanged?.({ isPlaying: false, isSeeking: false }));
    expect(chrome(1).paused).toBe(false);

    act(() => video("ep1").props.onBuffer?.({ isBuffering: false }));
    act(() => video("ep1").props.onPlaybackStateChanged?.({ isPlaying: false, isSeeking: false }));
    expect(chrome(1).paused).toBe(true);
  });

  it("AirPods out pauses instead of going on through the speaker", async () => {
    await renderFeed(VERTICAL());
    act(() => video("ep1").props.onAudioBecomingNoisy?.());
    expect(chrome(1).paused).toBe(true);
    expect(video("ep1").props.paused).toBe(true);
  });

  it("a neighbour page shows no play glyph — only the viewer's own pause does", async () => {
    await renderFeed(VERTICAL());
    swipeTo(1);

    // The page swiped away from is paused by the pool…
    expect(video("ep1").props.paused).toBe(true);
    // …which is not the viewer's pause: no disc on it mid-swipe.
    expect(chrome(1).paused).toBe(false);
  });

  it("swiping back to an episode that ended starts it over, playing", async () => {
    await renderFeed(VERTICAL());
    act(() => video("ep1").props.onLoad?.({ duration: 600 }));
    act(() => video("ep1").props.onEnd?.());
    // The end pauses the player too — onEnd owns that, not the OS-pause path.
    act(() => video("ep1").props.onPlaybackStateChanged?.({ isPlaying: false, isSeeking: false }));
    await flush();
    expect(video("ep1").props.paused).toBe(true);
    expect(chrome(1).paused).toBe(false);

    swipeTo(0);

    expect(video("ep1").seek).toHaveBeenLastCalledWith(0);
    expect(video("ep1").props.paused).toBe(false);
    expect(chrome(1).paused).toBe(false);
  });

  it("the last episode rests on its play glyph at the end", async () => {
    await renderFeed(makeShow("vertical", ["free"]));
    act(() => video("ep1").props.onEnd?.());
    expect(chrome(1).paused).toBe(true);

    act(() => chrome(1).onTogglePlay());
    expect(video("ep1").seek).toHaveBeenLastCalledWith(0);
    expect(chrome(1).paused).toBe(false);
  });
});
