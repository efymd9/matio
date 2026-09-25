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
}));

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
