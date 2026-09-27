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
  source: { uri: string; metadata?: { imageUri?: string } };
  paused: boolean;
  onLoad?: (e: { duration: number }) => void;
  onProgress?: (e: { currentTime: number }) => void;
  onEnd?: () => void;
  onError?: () => void;
  onBuffer?: (e: { isBuffering: boolean }) => void;
  onLoadStart?: () => void;
  onSeek?: () => void;
  onPlaybackStateChanged?: (e: { isPlaying: boolean; isSeeking: boolean }) => void;
  onAudioBecomingNoisy?: () => void;
  onPictureInPictureStatusChanged?: (e: { isActive: boolean }) => void;
  muted?: boolean;
  playInBackground?: boolean;
  playWhenInactive?: boolean;
  enterPictureInPictureOnLeave?: boolean;
  showNotificationControls?: boolean;
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
  chrome: new Map<string, { paused: boolean; buffering?: boolean; onTogglePlay: () => void }>(),
  allPages: false,
  // The feed list's props: its viewability callback is how a SWIPE changes
  // the page, and jsdom has no layout to fire it — a case calls it directly.
  list: null as null | {
    viewabilityConfigCallbackPairs?: Array<{
      onViewableItemsChanged: (info: { viewableItems: Array<{ index: number }> }) => void;
    }>;
  },
}));

// jsdom has no layout, so the virtualized list never renders past its first
// batch: only the opening page exists. A case about neighbour pages turns
// `h.allPages` on and every page is rendered — the feed's own pool rule
// still decides which of them carry a player.
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  const React = await import("react");
  const FlatList = React.forwardRef(function FlatList(props: object, ref) {
    h.list = props;
    const { data, initialNumToRender } = props as {
      data?: ArrayLike<unknown> | null;
      initialNumToRender?: number;
    };
    return React.createElement(rn.FlatList as never, {
      ...props,
      initialNumToRender: h.allPages ? (data?.length ?? 1) : initialNumToRender,
      ref,
    });
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
  VerticalChrome: (props: {
    episodeTitle: string;
    paused: boolean;
    buffering?: boolean;
    onTogglePlay: () => void;
  }) => {
    h.chrome.set(props.episodeTitle, props);
    return null;
  },
}));

const tokens = vi.hoisted(() => ({
  calls: [] as string[],
  answer: (() => undefined) as unknown as (episodeId: string) => Promise<PlaybackTokenResponse>,
}));
// The watch screen around the feed (#302 review): its route params, the show
// it loads, and whether its orientation has settled (the feed mounts only
// then; the settle grace re-renders the screen).
const screen = vi.hoisted(() => ({
  params: {} as Record<string, string | undefined>,
  show: null as unknown,
  settled: true,
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
      show: async () => screen.show,
      continueWatching: async () => ({ items: [] }),
    },
  };
});
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined }),
  useLocalSearchParams: () => screen.params,
}));
vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("@/auth/clerk", () => ({
  useOptionalAuth: () => ({ isLoaded: true, isSignedIn: false, stalled: false, retry: () => undefined }),
}));
vi.mock("@/orientation", () => ({
  useOrientationLock: () => null,
  useOrientationSettled: () => screen.settled,
}));

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
import WatchScreen from "@/app/watch/[episodeId]";
import { EpisodeFeed, PAUSE_REPORT_SETTLE_MS } from "./episode-feed";

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

async function renderFeed(
  show: ShowDetail,
  {
    signedIn = false,
    initialIndex = 0,
    resumeSeconds = 0,
    onCurrentChange,
  }: {
    signedIn?: boolean;
    initialIndex?: number;
    resumeSeconds?: number;
    onCurrentChange?: (index: number, positionSeconds: number) => void;
  } = {},
) {
  act(() =>
    root.render(
      <EpisodeFeed
        show={show}
        initialIndex={initialIndex}
        resumeSeconds={resumeSeconds}
        signedIn={signedIn}
        onBack={onBack}
        onSignIn={onSignIn}
        onCurrentChange={onCurrentChange}
      />,
    ),
  );
  await flush();
}

function leaf(label: string) {
  const node = Array.from(container.querySelectorAll("*")).find(
    (el) => el.children.length === 0 && el.textContent === label,
  );
  if (!node) throw new Error(`no element labelled ${label}`);
  return node;
}

function press(label: string) {
  const node = leaf(label);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

// The role VoiceOver announces for a visible text: its nearest ancestor with one.
const roleOf = (label: string) => leaf(label).closest("[role]")?.getAttribute("role") ?? null;

beforeEach(() => {
  vi.stubGlobal("__DEV__", false);
  setWindow(390, 844);
  h.videos.clear();
  h.mounts.length = 0;
  h.chrome.clear();
  h.allPages = false;
  screen.settled = true;
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

  it("a subscribers-only page has a visible way back — in landscape nothing else on screen leads out", async () => {
    await renderFeed(makeShow("horizontal", ["subscriber"]), { signedIn: true });

    expect(text()).toContain(SUBSCRIBERS_ONLY);
    expect(roleOf("Back")).toBe("link");
    press("Back");
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("so does the token route's 403 subscribe_required, next to its retry", async () => {
    // The client thinks the episode is open; the server says it needs a
    // subscription (the legacy 60s preview running out, say).
    gate = { mode: "none" };
    tokens.answer = async () => {
      throw new ApiError("forbidden", "Subscribe to keep watching.", 403, "subscribe_required");
    };
    await renderFeed(makeShow("horizontal", ["free"]));

    expect(text()).toContain(SUBSCRIBERS_ONLY);
    expect(text()).toContain(TRY_AGAIN);
    press("Back");
    expect(onBack).toHaveBeenCalledTimes(1);
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

  // The player's own report, and the settle window a "not playing" waits out.
  const report = (isPlaying: boolean, isSeeking = false, episodeId = "ep1") =>
    act(() => video(episodeId).props.onPlaybackStateChanged?.({ isPlaying, isSeeking }));
  const settle = () =>
    act(() => {
      vi.advanceTimersByTime(PAUSE_REPORT_SETTLE_MS);
    });

  it("an OS pause (lock screen, Control Center, a call) shows as paused, and the first tap plays", async () => {
    vi.useFakeTimers();
    await renderFeed(VERTICAL());
    expect(chrome(1).paused).toBe(false);

    report(false);
    // Not yet: the report waits for an explanation first.
    expect(video("ep1").props.paused).toBe(false);
    settle();
    expect(chrome(1).paused).toBe(true);
    expect(video("ep1").props.paused).toBe(true);

    act(() => chrome(1).onTogglePlay());
    expect(chrome(1).paused).toBe(false);
    expect(video("ep1").props.paused).toBe(false);
  });

  it("a play from the lock screen clears the pause at once", async () => {
    await renderFeed(VERTICAL());
    act(() => chrome(1).onTogglePlay());
    expect(chrome(1).paused).toBe(true);

    report(true);
    expect(chrome(1).paused).toBe(false);
  });

  // react-native-video on Android sends the playing state from ExoPlayer's
  // onIsPlayingChanged but onBuffer / onEnd from the LATER onEvents pass of
  // the same change: a stall reads "not playing" FIRST, then "buffering". A
  // pause taken on the first report set `paused` — setPlayWhenReady(false) —
  // and the stream never resumed.
  it("Android order: «not playing» THEN «buffering» is a stall, not a pause — playback is never stopped", async () => {
    vi.useFakeTimers();
    await renderFeed(VERTICAL());

    report(false);
    act(() => video("ep1").props.onBuffer?.({ isBuffering: true }));
    settle();
    settle();

    expect(video("ep1").props.paused).toBe(false);
    expect(chrome(1).paused).toBe(false);

    // Buffer done, playing again: still nothing paused.
    act(() => video("ep1").props.onBuffer?.({ isBuffering: false }));
    report(true);
    expect(video("ep1").props.paused).toBe(false);
  });

  it("a source reload (the hourly token swap) is not a pause either", async () => {
    vi.useFakeTimers();
    await renderFeed(VERTICAL());

    report(false);
    act(() => video("ep1").props.onLoadStart?.());
    settle();
    expect(video("ep1").props.paused).toBe(false);

    // Still loading: a later "not playing" is the reload too.
    report(false);
    settle();
    expect(video("ep1").props.paused).toBe(false);

    // Loaded — from here a bare "not playing" is a pause again.
    act(() => video("ep1").props.onLoad?.({ duration: 600 }));
    report(false);
    settle();
    expect(video("ep1").props.paused).toBe(true);
  });

  it("a seek — reported by the flag or by onSeek after the fact — is not a pause", async () => {
    vi.useFakeTimers();
    await renderFeed(VERTICAL());

    report(false, true);
    settle();
    expect(chrome(1).paused).toBe(false);

    report(false);
    act(() => video("ep1").props.onSeek?.());
    settle();
    expect(chrome(1).paused).toBe(false);
  });

  it("the end is not a pause on a page the feed advances past (Android reports the end second, too)", async () => {
    vi.useFakeTimers();
    await renderFeed(VERTICAL());

    report(false);
    act(() => video("ep1").props.onEnd?.());
    settle();

    expect(chrome(1).paused).toBe(false);
  });

  it("«not playing» then «playing» within the window changes nothing", async () => {
    vi.useFakeTimers();
    await renderFeed(VERTICAL());

    report(false);
    report(true);
    settle();

    expect(video("ep1").props.paused).toBe(false);
  });

  it("a landscape page leaves play/pause to the native transport", async () => {
    vi.useFakeTimers();
    await renderFeed(makeShow("horizontal", ["free"]));

    report(false);
    settle();
    act(() => video("ep1").props.onAudioBecomingNoisy?.());

    expect(video("ep1").props.paused).toBe(false);
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

describe("EpisodeFeed — every error page has a way back (#292 item 1)", () => {
  // An error replaces the whole page — the «‹» and the vertical chrome with
  // it — so «Back» on the error itself is the only visible exit.
  const backLeads = () => {
    expect(roleOf("Back")).toBe("link");
    press("Back");
    expect(onBack).toHaveBeenCalledTimes(1);
  };

  it("a token failure, next to its retry", async () => {
    tokens.answer = async () => {
      throw new ApiError("server_error", "boom", 500);
    };
    await renderFeed(makeShow("horizontal", ["free"]));

    expect(text()).toContain(TRY_AGAIN);
    backLeads();
  });

  it("the hourly limit", async () => {
    tokens.answer = async () => {
      throw new ApiError("rate_limited", "Too many.", 429);
    };
    await renderFeed(makeShow("horizontal", ["free"]));

    expect(text()).toContain(TRY_AGAIN);
    backLeads();
  });

  it("a player that failed to play", async () => {
    await renderFeed(makeShow("horizontal", ["free"]));
    act(() => video("ep1").props.onError?.());

    expect(text()).toContain("Playback unavailable");
    backLeads();
  });

  it("a signed-in viewer answered signup_required twice", async () => {
    vi.useFakeTimers();
    tokens.answer = async () => {
      throw SIGNUP_REQUIRED();
    };
    await renderFeed(makeShow("horizontal", ["member"]), { signedIn: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(text()).toContain("Playback unavailable");
    backLeads();
  });

  it("a vertical page too — its chrome goes with the page", async () => {
    tokens.answer = async () => {
      throw new ApiError("server_error", "boom", 500);
    };
    await renderFeed(makeShow("vertical", ["free"]));

    expect(text()).toContain("Playback unavailable");
    backLeads();
  });
});

describe("EpisodeFeed — a vertical stall is visible (#292 item 5)", () => {
  const chrome = (n: number) => {
    const c = h.chrome.get(`Episode ${n}`);
    if (!c) throw new Error(`no chrome for episode ${n}`);
    return c;
  };

  it("the page in view shows the spinner while the player buffers", async () => {
    await renderFeed(makeShow("vertical", ["free", "free"]));
    expect(chrome(1).buffering).toBe(false);

    act(() => video("ep1").props.onBuffer?.({ isBuffering: true }));
    expect(chrome(1).buffering).toBe(true);

    act(() => video("ep1").props.onBuffer?.({ isBuffering: false }));
    expect(chrome(1).buffering).toBe(false);
  });

  it("a page kept warm in the pool does not — only the page in view", async () => {
    await renderFeed(makeShow("vertical", ["free", "free"]));
    // Swiped on: episode 1 stays mounted, paused, as the previous page.
    act(() =>
      h.list?.viewabilityConfigCallbackPairs?.[0].onViewableItemsChanged({
        viewableItems: [{ index: 1 }],
      }),
    );
    act(() => video("ep1").props.onBuffer?.({ isBuffering: true }));

    expect(chrome(1).buffering).toBe(false);
  });
});

describe("EpisodeFeed — the lock-screen artwork is resized (#292 item 10)", () => {
  it("hands the OS the poster through the image optimizer, not the original", async () => {
    const poster = "https://waoyoctqyyvecbhm.public.blob.vercel-storage.com/shows/poster-scarlet.png";
    await renderFeed({ ...makeShow("horizontal", ["free"]), posterImageUrl: poster });

    const imageUri = video("ep1").props.source.metadata?.imageUri;
    const params = new URL(imageUri ?? "").searchParams;
    expect(imageUri?.startsWith("https://matio.tv/_next/image?")).toBe(true);
    expect(params.get("url")).toBe(poster);
    expect(params.get("w")).toBe("640");
  });
});

// ---- #302: the player feed's robustness ---------------------------------

// Every episode's tokens numbered on their own (ep2's first grant is
// tok-ep2-1 whatever ep1 asked for before it); `fail` turns an attempt into
// a rejection.
function countingGrants(
  fail: (episodeId: string, attempt: number) => ApiError | null = () => null,
  expiresIn = 3600,
) {
  const counts = new Map<string, number>();
  tokens.answer = async (episodeId) => {
    const n = (counts.get(episodeId) ?? 0) + 1;
    counts.set(episodeId, n);
    const err = fail(episodeId, n);
    if (err) throw err;
    return { ...granted(episodeId, n), expiresIn };
  };
}
const callsFor = (episodeId: string) => tokens.calls.filter((id) => id === episodeId).length;

// A swipe: the list's viewability callback, as FlatList would fire it.
const swipe = (index: number) =>
  act(() =>
    h.list?.viewabilityConfigCallbackPairs?.[0].onViewableItemsChanged({
      viewableItems: [{ index }],
    }),
  );

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

// The rendered <Video> of a grant, if it is mounted at all.
const playerEl = (episodeId: string, n = 1) =>
  container.querySelector(`[data-video="${uri(episodeId, n)}"]`);
// Whether VoiceOver / TalkBack can reach a node (react-native-web renders
// `aria-hidden` as the DOM attribute).
const hiddenFromReader = (node: Element | null) => {
  if (!node) throw new Error("no such node");
  return node.closest('[aria-hidden="true"]') !== null;
};

describe("EpisodeFeed — a neighbour whose warm-up failed is retried when it comes into view (#302 item 1)", () => {
  beforeEach(() => {
    h.allPages = true;
  });

  it("the auto-advance lands on a player, not on «Playback unavailable», after one blip on the warm-up fetch", async () => {
    countingGrants((id, n) =>
      id === "ep2" && n === 1 ? new ApiError("network", "The request timed out.", 0) : null,
    );
    await renderFeed(makeShow("horizontal", ["free", "free"]));

    // 45s before the end the next page arms — and its fetch hits the blip.
    act(() => video("ep1").props.onLoad?.({ duration: 600 }));
    act(() => video("ep1").props.onProgress?.({ currentTime: 560 }));
    await flush();
    expect(callsFor("ep2")).toBe(1);

    act(() => video("ep1").props.onEnd?.());
    await flush();

    expect(callsFor("ep2")).toBe(2);
    expect(video("ep2", 2).props.paused).toBe(false);
    expect(text()).not.toContain("Playback unavailable");
  });

  it("so does a swipe on a vertical show, whose neighbour warms at mount", async () => {
    countingGrants((id, n) =>
      id === "ep2" && n === 1 ? new ApiError("server_error", "Request failed (503).", 503) : null,
    );
    await renderFeed(makeShow("vertical", ["free", "free", "free"]));
    expect(callsFor("ep2")).toBe(1);

    swipe(1);
    await flush();

    expect(callsFor("ep2")).toBe(2);
    expect(video("ep2", 2).props.paused).toBe(false);
    expect(text()).not.toContain("Playback unavailable");
  });

  it("a neighbour whose paused player failed comes into view on a fresh token and player", async () => {
    countingGrants();
    await renderFeed(makeShow("vertical", ["free", "free"]));
    act(() => video("ep2").props.onError?.());

    swipe(1);
    await flush();

    expect(callsFor("ep2")).toBe(2);
    expect(video("ep2", 2).props.paused).toBe(false);
    expect(text()).not.toContain("Playback unavailable");
  });

  it("a 429 is an answer, not a blip — no retry", async () => {
    countingGrants((id) =>
      id === "ep2" ? new ApiError("rate_limited", "Too many requests.", 429) : null,
    );
    await renderFeed(makeShow("vertical", ["free", "free"]));

    swipe(1);
    await flush();

    expect(callsFor("ep2")).toBe(1);
    expect(text()).toContain("Too many previews");
  });

  it("once per coming into view: a second failure is the error page with its Try again", async () => {
    countingGrants((id) => (id === "ep2" ? new ApiError("network", "Network request failed.", 0) : null));
    await renderFeed(makeShow("vertical", ["free", "free"]));

    swipe(1);
    await flush();
    await flush();
    expect(callsFor("ep2")).toBe(2);
    expect(text()).toContain("Playback unavailable");
    expect(text()).toContain(TRY_AGAIN);

    // Swiped away and back: one more quiet attempt, no loop.
    swipe(0);
    swipe(1);
    await flush();
    expect(callsFor("ep2")).toBe(3);
  });

  it("a failure on the page in view is not retried behind the viewer's back — its Try again is on screen", async () => {
    tokens.answer = async () => {
      throw new ApiError("network", "Network request failed.", 0);
    };
    await renderFeed(makeShow("horizontal", ["free"]));
    await flush();

    expect(tokens.calls).toEqual(["ep1"]);
    expect(text()).toContain(TRY_AGAIN);
  });
});

describe("EpisodeFeed — the lock screen and picture-in-picture (#302 item 2)", () => {
  beforeEach(() => {
    h.allPages = true;
  });

  const chrome = (n: number) => {
    const c = h.chrome.get(`Episode ${n}`);
    if (!c) throw new Error(`no chrome for episode ${n}`);
    return c;
  };

  // react-native-video (iOS) lets a player go on in the background only if
  // it had playInBackground when the app went there: a neighbour the
  // auto-advance makes current on a locked phone must already carry it.
  it("every pooled player may play in the background; PiP on leave and the lock-screen controls stay with the page in view", async () => {
    await renderFeed(makeShow("vertical", ["free", "free", "free"]));

    const next = video("ep2");
    expect(next.props.paused).toBe(true);
    expect(next.props.playInBackground).toBe(true);
    expect(next.props.playWhenInactive).toBe(true);
    expect(next.props.enterPictureInPictureOnLeave).toBe(false);
    expect(next.props.showNotificationControls).toBe(false);

    const playing = video("ep1");
    expect(playing.props.playInBackground).toBe(true);
    expect(playing.props.enterPictureInPictureOnLeave).toBe(true);
    expect(playing.props.showNotificationControls).toBe(true);
  });

  it("an episode that ends in a PiP window stays in it — the feed advances when the window closes", async () => {
    await renderFeed(makeShow("vertical", ["free", "free"]));

    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: true }));
    act(() => video("ep1").props.onEnd?.());
    await flush();
    // Still on episode 1: the next page did not become current.
    expect(video("ep1").props.enterPictureInPictureOnLeave).toBe(true);
    expect(video("ep2").props.paused).toBe(true);

    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: false }));
    await flush();
    expect(video("ep2").props.paused).toBe(false);
    expect(video("ep1").props.paused).toBe(true);
  });

  it("a landscape page keeps its player (and so its window) until the window closes", async () => {
    await renderFeed(makeShow("horizontal", ["free", "free"]));
    act(() => video("ep1").props.onLoad?.({ duration: 600 }));
    act(() => video("ep1").props.onProgress?.({ currentTime: 560 }));
    await flush();

    // The native transport's PiP button.
    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: true }));
    act(() => video("ep1").props.onEnd?.());
    await flush();
    expect(playerEl("ep1")).not.toBeNull();
    expect(video("ep2").props.paused).toBe(true);

    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: false }));
    await flush();
    expect(video("ep2").props.paused).toBe(false);
    // Advanced: the page behind leaves the landscape pool.
    expect(playerEl("ep1")).toBeNull();
  });

  it("a window closed mid-episode changes nothing", async () => {
    await renderFeed(makeShow("vertical", ["free", "free"]));

    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: true }));
    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: false }));
    await flush();

    expect(video("ep1").props.paused).toBe(false);
    expect(video("ep2").props.paused).toBe(true);
  });

  it("the last episode, ended in a window, rests on its play glyph once the window closes", async () => {
    await renderFeed(makeShow("vertical", ["free"]));

    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: true }));
    act(() => video("ep1").props.onEnd?.());
    expect(chrome(1).paused).toBe(false);

    act(() => video("ep1").props.onPictureInPictureStatusChanged?.({ isActive: false }));
    expect(chrome(1).paused).toBe(true);
  });
});

describe("EpisodeFeed — a page re-created in the pool starts where it was (#302 item 3)", () => {
  beforeEach(() => {
    h.allPages = true;
    countingGrants();
  });

  it("a page that left the pool and came back resumes at its playhead, not at 0:00", async () => {
    await renderFeed(makeShow("vertical", ["free", "free", "free"]));
    act(() => video("ep1").props.onLoad?.({ duration: 600 }));
    act(() => video("ep1").props.onProgress?.({ currentTime: 300 }));

    // Two pages on: episode 1 leaves the pool…
    swipe(1);
    swipe(2);
    await flush();
    expect(playerEl("ep1")).toBeNull();
    // …and one back re-creates it, on a new token.
    swipe(1);
    await flush();

    const again = video("ep1", 2);
    act(() => again.props.onLoad?.({ duration: 600 }));
    expect(again.seek).toHaveBeenCalledWith(300);
  });

  it("the deep-linked episode, once finished, comes back at 0:00 — not at the stale resume", async () => {
    await renderFeed(makeShow("vertical", ["free", "free", "free"]), { resumeSeconds: 300 });
    const first = video("ep1");
    act(() => first.props.onLoad?.({ duration: 600 }));
    expect(first.seek).toHaveBeenCalledWith(300);
    act(() => first.props.onProgress?.({ currentTime: 599 }));
    act(() => first.props.onEnd?.());
    await flush();

    swipe(2);
    await flush();
    swipe(1);
    await flush();

    const again = video("ep1", 2);
    act(() => again.props.onLoad?.({ duration: 600 }));
    expect(again.seek).not.toHaveBeenCalled();
  });

  it("tells the screen the page in view and where it stands", async () => {
    const onCurrentChange = vi.fn();
    await renderFeed(makeShow("vertical", ["free", "free", "free"]), {
      onCurrentChange,
      resumeSeconds: 90,
    });
    // Not played yet: where it will start — the position it was opened at,
    // never "unknown" (the screen reopens there).
    expect(onCurrentChange).toHaveBeenLastCalledWith(0, 90);

    act(() => video("ep1").props.onProgress?.({ currentTime: 42 }));
    expect(onCurrentChange).toHaveBeenLastCalledWith(0, 42);
    // A neighbour's samples are not the page in view's.
    act(() => video("ep2").props.onProgress?.({ currentTime: 7 }));
    expect(onCurrentChange).toHaveBeenLastCalledWith(0, 42);

    swipe(1);
    expect(onCurrentChange).toHaveBeenLastCalledWith(1, 7);
    // The end: 0 for the page that ended, then the feed moves on to a page
    // that never played, away from the deep link — the start.
    act(() => video("ep2").props.onEnd?.());
    expect(onCurrentChange).toHaveBeenCalledWith(1, 0);
    expect(onCurrentChange).toHaveBeenLastCalledWith(2, 0);
    // Back on the deep-linked page: its playhead, not the stale resume.
    swipe(1);
    swipe(0);
    expect(onCurrentChange).toHaveBeenLastCalledWith(0, 42);
  });

  it("a live feed is not re-seeded by a later render of the screen", async () => {
    await renderFeed(makeShow("horizontal", ["free", "free"]), { resumeSeconds: 300 });
    // The screen renders again before the stream has loaded — with a
    // different page and position (its settle grace, a newer report).
    await renderFeed(makeShow("horizontal", ["free", "free"]), {
      initialIndex: 1,
      resumeSeconds: 0,
    });

    act(() => video("ep1").props.onLoad?.({ duration: 600 }));
    expect(video("ep1").seek).toHaveBeenCalledWith(300);
    expect(video("ep1").props.paused).toBe(false);
  });
});

// The watch screen and the real feed together: the feed is taken down while
// a screen covers the player and remounted on its return, and the screen's
// settle grace re-renders it a second later — before the reopened stream has
// loaded (#302 review).
describe("the watch screen reopens the feed at the carried playhead (#302 item 3)", () => {
  beforeEach(() => {
    h.allPages = true;
    countingGrants();
    screen.show = makeShow("horizontal", ["free", "free", "free"]);
    // The rail's deep link: episode 1 at 5:00.
    screen.params = { episodeId: "ep1", showSlug: "the-scarlet-oath", resume: "300" };
  });

  async function renderScreen() {
    await act(async () => {
      root.render(<WatchScreen />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await flush();
  }

  // A screen pushed over the player and popped, then the grace re-render.
  async function coverAndReturn() {
    screen.settled = false;
    await renderScreen();
    screen.settled = true;
    await renderScreen();
    await renderScreen();
  }

  it("at 20:00 of episode 3, the reopened page seeks to 20:00 — not to 0:00", async () => {
    await renderScreen();
    act(() => video("ep1").props.onLoad?.({ duration: 1800 }));
    expect(video("ep1").seek).toHaveBeenCalledWith(300);
    // Autoplay rolls episode 1 into 2, and 2 into 3.
    act(() => video("ep1").props.onEnd?.());
    await flush();
    act(() => video("ep2").props.onEnd?.());
    await flush();
    act(() => video("ep3").props.onLoad?.({ duration: 1800 }));
    act(() => video("ep3").props.onProgress?.({ currentTime: 1200 }));

    await coverAndReturn();

    const reopened = video("ep3", 2);
    act(() => reopened.props.onLoad?.({ duration: 1800 }));
    expect(reopened.seek).toHaveBeenCalledWith(1200);
  });

  it("at 20:00 of the deep-linked episode itself, it seeks to 20:00 — not back to the link's 5:00", async () => {
    await renderScreen();
    act(() => video("ep1").props.onLoad?.({ duration: 1800 }));
    act(() => video("ep1").props.onProgress?.({ currentTime: 1200 }));

    await coverAndReturn();

    const reopened = video("ep1", 2);
    act(() => reopened.props.onLoad?.({ duration: 1800 }));
    expect(reopened.seek).toHaveBeenCalledWith(1200);
    expect(reopened.seek).not.toHaveBeenCalledWith(300);
  });

  it("a page covered before it ever played keeps the deep link's resume", async () => {
    await renderScreen();

    await coverAndReturn();

    const reopened = video("ep1", 2);
    act(() => reopened.props.onLoad?.({ duration: 1800 }));
    expect(reopened.seek).toHaveBeenCalledWith(300);
  });
});

describe("EpisodeFeed — only the page in view speaks to VoiceOver (#302 item 4)", () => {
  beforeEach(() => {
    h.allPages = true;
  });

  it("a vertical show: the neighbours' pages are hidden, and a swipe moves that with the page", async () => {
    await renderFeed(makeShow("vertical", ["free", "free", "free"]));
    expect(hiddenFromReader(playerEl("ep1"))).toBe(false);
    expect(hiddenFromReader(playerEl("ep2"))).toBe(true);

    swipe(1);
    await flush();

    expect(hiddenFromReader(playerEl("ep1"))).toBe(true);
    expect(hiddenFromReader(playerEl("ep2"))).toBe(false);
    expect(hiddenFromReader(playerEl("ep3"))).toBe(true);
  });

  it("a landscape show: the next page's title and «‹» are out of reach", async () => {
    await renderFeed(makeShow("horizontal", ["free", "free"]));

    expect(hiddenFromReader(leaf("Episode 1"))).toBe(false);
    expect(hiddenFromReader(leaf("Episode 2"))).toBe(true);
    const backs = Array.from(container.querySelectorAll('[aria-label="Back to show"]'));
    expect(backs).toHaveLength(2);
    expect(backs.filter((b) => !hiddenFromReader(b))).toHaveLength(1);
  });

  it("so is a locked neighbour's wall", async () => {
    await renderFeed(makeShow("horizontal", ["free", "member"]));

    expect(hiddenFromReader(leaf(WALL_CTA))).toBe(true);
  });
});

describe("EpisodeFeed — the token refresh (#302 item 6)", () => {
  it("swaps in the new token where the viewer was, and schedules the next refresh", async () => {
    vi.useFakeTimers();
    countingGrants(undefined, 61); // refresh one second in
    await renderFeed(makeShow("horizontal", ["free"]));

    const first = video("ep1", 1);
    act(() => first.props.onLoad?.({ duration: 600 }));
    act(() => first.props.onProgress?.({ currentTime: 300 }));
    expect(first.seek).not.toHaveBeenCalled();

    await advance(1_000);
    expect(tokens.calls).toEqual(["ep1", "ep1"]);
    const second = video("ep1", 2);
    expect(second.props.paused).toBe(false);
    act(() => second.props.onLoad?.({ duration: 600 }));
    expect(second.seek).toHaveBeenLastCalledWith(300);

    await advance(1_000);
    expect(tokens.calls).toEqual(["ep1", "ep1", "ep1"]);
  });

  it("a refresh failing on 5xx retries after 1s, 2s and 4s — the old token playing meanwhile — then gives up", async () => {
    vi.useFakeTimers();
    countingGrants(
      (_, n) => (n > 1 ? new ApiError("server_error", "Request failed (503).", 503) : null),
      61,
    );
    await renderFeed(makeShow("horizontal", ["free"]));

    await advance(1_000);
    expect(tokens.calls).toHaveLength(2);
    await advance(999);
    expect(tokens.calls).toHaveLength(2);
    await advance(1);
    expect(tokens.calls).toHaveLength(3);
    await advance(2_000);
    expect(tokens.calls).toHaveLength(4);
    expect(video("ep1").props.paused).toBe(false);
    expect(text()).not.toContain("Playback unavailable");

    await advance(4_000);
    expect(tokens.calls).toHaveLength(5);
    expect(text()).toContain("Playback unavailable");

    await advance(60_000);
    expect(tokens.calls).toHaveLength(5);
  });

  it("a page swiped away before its refresh stops refreshing", async () => {
    vi.useFakeTimers();
    countingGrants(undefined, 61);
    await renderFeed(makeShow("vertical", ["free", "free"]));

    await advance(500);
    swipe(1);
    await advance(10_000);

    expect(callsFor("ep1")).toBe(1);
  });
});
