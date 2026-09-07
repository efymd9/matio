/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import {
  CONSENT_VERSION,
  broadcastConsentChange,
  writeConsentToDocument,
} from "@/lib/cookie-consent";
import { en } from "@/lib/i18n/dictionaries";

// Issue #127 asked whether the watch player repeats the hero's #126 failure —
// a consent flip mutating a live Mux element into `unload(); …then(() =>
// play())` with no `.catch`. It does not, and this suite pins down WHY, with
// the real wrapper: @mux/mux-video-react renders a bare <video> and reads the
// Mux Data props only inside playback-core's initialize(), from an effect
// keyed on the src alone (dist/index.mjs, 0.31.2):
//
//   useEffect(() => { … o.current = initialize(t, a, o.current) …
//                     return () => { teardown(a, o.current) … } }, [d])
//
// where `d` is the Mux URL derived from playbackId/src. A prop flip on a
// mounted element therefore touches nothing — no unload, no reload, no
// play() — which is the good news, and also the defect: a WITHDRAWAL leaves
// the running monitor beaconing until the next initialize. The Player's job
// is to stop it on the spot, without touching the stream; the second
// describe holds it to that in both player orientations.

// ---------------------------------------------------------------------------
// Probe standing in for @mux/mux-video-react in the Player tests: a
// miniature of the real wrapper's contract (bare <video>, Mux-only props kept
// off the DOM, initialize/teardown keyed on the src, `el.mux` installed by
// setupMux when tracking is on and destroyed by teardown). It records every
// initialize so the suite can tell "same element, no re-init" from "remount".
const probe = vi.hoisted(() => ({
  inits: [] as Array<{
    el: HTMLVideoElement;
    playbackId: unknown;
    envKey: unknown;
    disableTracking: unknown;
    disableCookies: unknown;
    // Wall clock of the initialize (fake under vi.useFakeTimers) — lets the
    // refresh-hold test read the schedule off the log.
    at: number;
  }>,
  teardowns: 0,
  destroys: 0,
  // Props of the live probe's latest render — what the NEXT initialize reads.
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("@mux/mux-video-react", async () => {
  const React = await import("react");
  // The real wrapper strips its own propTypes off the <video>; same set here.
  const MUX_ONLY = new Set([
    "playbackId",
    "tokens",
    "streamType",
    "envKey",
    "disableTracking",
    "disableCookies",
    "metadata",
  ]);
  const MuxVideoProbe = React.forwardRef<
    HTMLVideoElement,
    Record<string, unknown>
  >(function MuxVideoProbe(props, ref) {
    const { playbackId, envKey, disableTracking, disableCookies } = props;
    probe.lastProps = props;
    const native = Object.fromEntries(
      Object.entries(props).filter(([k]) => !MUX_ONLY.has(k)),
    );
    const inner = React.useRef<HTMLVideoElement | null>(null);
    const setRefs = React.useCallback(
      (el: HTMLVideoElement | null) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    React.useEffect(() => {
      const el = inner.current;
      if (!el) return;
      probe.inits.push({
        el,
        playbackId,
        envKey,
        disableTracking,
        disableCookies,
        at: Date.now(),
      });
      el.setAttribute("src", `https://stream.mux.com/${String(playbackId)}.m3u8`);
      if (!disableTracking) {
        const handle = {
          deleted: false,
          destroy: () => {
            handle.deleted = true;
            probe.destroys += 1;
          },
        };
        el.mux = handle as unknown as HTMLVideoElement["mux"];
      }
      return () => {
        probe.teardowns += 1;
        if (el.mux && !el.mux.deleted) el.mux.destroy();
        delete el.mux;
      };
      // Keyed on the src alone, exactly like the wrapper: the consent props
      // are deliberately NOT dependencies — that is the contract under test.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playbackId]);
    return <video ref={setRefs} data-testid="mux-video" {...native} />;
  });
  return { default: MuxVideoProbe };
});

// media-chrome's web components need ResizeObserver & co.; the chrome is not
// the subject here, so every control becomes a tagged <div>.
vi.mock("media-chrome/react", async () => {
  const React = await import("react");
  const stub = (name: string) =>
    function Chrome({ children }: { children?: React.ReactNode }) {
      return React.createElement("div", { "data-chrome": name }, children);
    };
  return {
    MediaAirplayButton: stub("airplay"),
    MediaCaptionsButton: stub("captions"),
    MediaController: stub("controller"),
    MediaFullscreenButton: stub("fullscreen"),
    MediaMuteButton: stub("mute"),
    MediaPlayButton: stub("play"),
    MediaPlaybackRateButton: stub("rate"),
    MediaTimeDisplay: stub("time"),
    MediaTimeRange: stub("range"),
  };
});
vi.mock("media-chrome/react/menu", async () => {
  const React = await import("react");
  const stub = (name: string) =>
    function Menu({ children }: { children?: React.ReactNode }) {
      return React.createElement("div", { "data-chrome": name }, children);
    };
  return {
    MediaRenditionMenu: stub("rendition-menu"),
    MediaRenditionMenuButton: stub("rendition-button"),
  };
});

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/watch/the-scarlet-oath",
  useSearchParams: () => new URLSearchParams("ep=ep-1"),
}));

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

const actions = vi.hoisted(() => ({
  saveWatchProgress: vi.fn(async () => undefined),
  saveTrialPosition: vi.fn(async () => undefined),
  saveWatchSegments: vi.fn(async () => undefined),
}));
vi.mock("@/app/watch/actions", () => actions);
vi.mock("@/lib/posthog-events", () => ({ capturePostHog: vi.fn() }));
vi.mock("@/lib/meta-pixel-events", () => ({
  onPixelReady: vi.fn(() => () => undefined),
  trackPixel: vi.fn(),
}));

// Module-level const in the player (read at import, which is hoisted above
// ordinary statements) — same reason the hero suite sets it in vi.hoisted.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY = "env-key-test";
});

import { Player, type PlayerEpisode } from "./player";

// jsdom's HTMLMediaElement has no play()/pause()/load() (they log "not
// implemented" and return undefined — `play().catch` would throw). Stubs that
// resolve, and count: a reload or a library-driven play() would show up here.
const media = {
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  load: vi.fn(),
};

function setConsent(marketing: boolean) {
  writeConsentToDocument({
    necessary: true,
    marketing,
    ts: Date.now(),
    v: CONSENT_VERSION,
  });
}

// What the cookie banner does on Accept / Essential-only, minus the UI.
function flipConsent(marketing: boolean) {
  act(() => {
    setConsent(marketing);
    broadcastConsentChange(marketing);
  });
}

function mockViewport(mobile: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: mobile && query === "(max-width: 768px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function episode(
  id: string,
  number: number,
  overrides: Partial<PlayerEpisode> = {},
): PlayerEpisode {
  return {
    id,
    number,
    seasonNumber: 1,
    title: `Episode ${number}`,
    description: null,
    durationSeconds: 600,
    playbackId: `pb-${id.replace(/^ep-/, "")}`,
    introStartSeconds: null,
    introEndSeconds: null,
    thumbnailUrl: null,
    tier: "free",
    branchOfEpisodeId: null,
    forkPrompt: null,
    forkWindowSeconds: 10,
    choices: null,
    ...overrides,
  };
}

const EPISODES: PlayerEpisode[] = [episode("ep-1", 1), episode("ep-2", 2)];

// A branching show (#144), in the order the watch page delivers it — the
// linear run first, branches (900+) after: ep-2 forks into Kiss (901) and
// Hug (902, the default), both reconverge silently into ep-3; 931 is an
// ending hanging off ep-3.
const BRANCHING: PlayerEpisode[] = [
  episode("ep-1", 1),
  episode("ep-2", 2, {
    forkPrompt: "Kiss him or hug him?",
    forkWindowSeconds: 10,
    choices: [
      { toEpisodeId: "b-901", position: 1, label: "Kiss him", isDefault: false },
      { toEpisodeId: "b-902", position: 2, label: "Hug him", isDefault: true },
    ],
  }),
  episode("ep-3", 3),
  episode("b-901", 901, {
    title: "She kisses him",
    playbackId: "pb-901",
    branchOfEpisodeId: "ep-2",
    choices: [{ toEpisodeId: "ep-3", position: 1, label: "", isDefault: false }],
  }),
  episode("b-902", 902, {
    title: "She hugs him",
    playbackId: "pb-902",
    branchOfEpisodeId: "ep-2",
    choices: [{ toEpisodeId: "ep-3", position: 1, label: "", isDefault: false }],
  }),
  episode("b-931", 931, {
    title: "The end",
    playbackId: "pb-931",
    branchOfEpisodeId: "ep-3",
    choices: [],
  }),
];

function renderPlayer(
  orientation: "horizontal" | "vertical" = "horizontal",
  opts: { episodes?: PlayerEpisode[]; initialEpisodeId?: string } = {},
) {
  return render(
    <Player
      episodes={opts.episodes ?? EPISODES}
      initialEpisodeId={opts.initialEpisodeId ?? "ep-1"}
      mode="member"
      showId="show-1"
      showSlug="the-scarlet-oath"
      showTitle="The Scarlet Oath"
      freeMode
      orientation={orientation}
    />,
  );
}

beforeEach(() => {
  probe.inits = [];
  probe.teardowns = 0;
  probe.destroys = 0;
  probe.lastProps = null;
  media.play.mockClear();
  media.pause.mockClear();
  media.load.mockClear();
  for (const [name, value] of Object.entries(media)) {
    Object.defineProperty(HTMLMediaElement.prototype, name, {
      configurable: true,
      value,
    });
  }
  // Native HLS "supported": steers playback-core onto the plain <video>
  // path (jsdom has no MediaSource for hls.js), so initialize() really sets
  // a src and really calls setupMux.
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
    configurable: true,
    value: () => "probably",
  });
  mockViewport(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/playback-token")) {
        const ep = new URL(url, "http://localhost").searchParams.get(
          "episode_id",
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: `tok-${ep}`, expiresIn: 3600, mode: "member" }),
        } as unknown as Response;
      }
      // playback-core's playlist probe (native path) — a rejection it handles.
      throw new Error(`offline: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = "cookie_consent=; max-age=0; path=/";
  document.cookie = "muxData=; max-age=0; path=/";
});

describe("@mux/mux-video-react (real) — a consent flip on a mounted element", () => {
  // The real wrapper, the real playback-core AND the real mux-embed: the
  // monitor it installs on the element (`el.mux`, `deleted` flag) is the
  // witness for "was Mux Data (re)started or stopped". Its beacons are made
  // inert — jsdom has no sendBeacon, and the XHR fallback must not reach the
  // network from a test.
  async function mountReal(tracking: boolean) {
    const { default: RealMuxVideo } =
      await vi.importActual<typeof import("@mux/mux-video-react")>(
        "@mux/mux-video-react",
      );
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: () => true,
    });
    const ref = createRef<HTMLVideoElement>();
    const element = (on: boolean) => (
      <RealMuxVideo
        ref={ref}
        playbackId="pb-real"
        tokens={{ playback: "tok" }}
        streamType="on-demand"
        envKey={on ? "env-key-test" : undefined}
        disableTracking={!on}
        disableCookies={!on}
      />
    );
    const view = render(element(tracking));
    await act(async () => {});
    return { view, ref, element };
  }

  it("withdrawal: nothing is unloaded, reloaded or play()ed — and nothing is stopped either", async () => {
    const { view, ref, element } = await mountReal(true);
    const el = ref.current!;
    const handle = el.mux;
    expect(handle?.deleted).toBe(false);
    // What a consented view leaves behind — the cookie clearMarketingCookies
    // now takes with it on withdrawal (lib/cookie-consent.test.ts).
    expect(document.cookie).toContain("muxData=");
    const src = el.getAttribute("src");
    expect(src).toContain("pb-real");

    view.rerender(element(false));
    await act(async () => {});

    // The good news (#127's premise does not hold here)…
    expect(ref.current).toBe(el);
    expect(el.getAttribute("src")).toBe(src);
    expect(media.load).not.toHaveBeenCalled();
    expect(media.play).not.toHaveBeenCalled();
    expect(media.pause).not.toHaveBeenCalled();
    // …and the defect the Player has to cover: the very same monitor keeps
    // running after the props said "stop".
    expect(el.mux).toBe(handle);
    expect(handle?.deleted).toBe(false);

    // Its lifecycle is initialize/teardown only.
    view.unmount();
    expect(handle?.deleted).toBe(true);
  });

  it("grant: the mounted element is left alone — Mux Data does not start mid-stream", async () => {
    const { view, ref, element } = await mountReal(false);
    const el = ref.current!;
    expect(el.mux).toBeUndefined();

    view.rerender(element(true));
    await act(async () => {});

    expect(ref.current).toBe(el);
    expect(el.mux).toBeUndefined();
    expect(media.load).not.toHaveBeenCalled();
    expect(media.play).not.toHaveBeenCalled();
  });
});

describe("Player — Mux Data consent on the live element", () => {
  it.each(["horizontal", "vertical"] as const)(
    "[%s] withdrawal mid-episode stops the monitor on the spot and leaves the stream untouched",
    async (orientation) => {
      mockViewport(orientation === "vertical");
      setConsent(true);
      renderPlayer(orientation);
      const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
      await waitFor(() => expect(probe.inits).toHaveLength(1));
      expect(probe.inits[0]).toMatchObject({
        playbackId: "pb-1",
        envKey: "env-key-test",
        disableTracking: false,
        disableCookies: false,
      });
      expect(video.mux?.deleted).toBe(false);
      // The right chrome is on screen — any player edit is checked in both.
      if (orientation === "vertical") {
        expect(screen.getByLabelText(en.player.lockAria)).toBeTruthy();
        expect(document.querySelector('[data-chrome="rate"]')).toBeNull();
      } else {
        expect(document.querySelector('[data-chrome="rate"]')).toBeTruthy();
      }

      flipConsent(false);

      // Beacons stop now: mux-embed's own destroy, nothing else.
      expect(probe.destroys).toBe(1);
      expect(video.mux?.deleted).toBe(true);
      // No re-initialize, no teardown, same element, same src, no media call.
      expect(probe.inits).toHaveLength(1);
      expect(probe.teardowns).toBe(0);
      expect(screen.getByTestId("mux-video")).toBe(video);
      expect(video.getAttribute("src")).toBe("https://stream.mux.com/pb-1.m3u8");
      expect(media.load).not.toHaveBeenCalled();
      expect(media.pause).not.toHaveBeenCalled();
      // The next initialize (auto-advance / remount) is armed to stay off.
      expect(probe.lastProps).toMatchObject({
        disableTracking: true,
        disableCookies: true,
        envKey: undefined,
      });

      // A later grant is deferred (no re-init), so a second withdrawal finds
      // the same, already-destroyed handle — and must not destroy it twice.
      flipConsent(true);
      flipConsent(false);
      expect(probe.inits).toHaveLength(1);
      expect(probe.destroys).toBe(1);
    },
  );

  it("grant mid-episode leaves the running element alone and lands at the next initialize", async () => {
    setConsent(false);
    renderPlayer();
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    expect(probe.inits[0]).toMatchObject({
      disableTracking: true,
      disableCookies: true,
      envKey: undefined,
    });
    expect(video.mux).toBeUndefined();

    flipConsent(true);

    // Nothing starts mid-stream; the live props now carry the consent…
    expect(probe.inits).toHaveLength(1);
    expect(video.mux).toBeUndefined();
    expect(probe.destroys).toBe(0);
    expect(probe.lastProps).toMatchObject({
      disableTracking: false,
      disableCookies: false,
      envKey: "env-key-test",
    });

    // …and the gapless auto-advance — a src swap on the SAME element — is
    // the next initialize, which picks it up.
    await act(async () => {
      video.dispatchEvent(new Event("ended"));
    });
    await waitFor(() => expect(probe.inits).toHaveLength(2));
    expect(probe.inits[1]).toMatchObject({
      playbackId: "pb-2",
      disableTracking: false,
      disableCookies: false,
      envKey: "env-key-test",
    });
    expect(probe.inits[1].el).toBe(video);
    expect(screen.getByTestId("mux-video")).toBe(video);
    expect(video.mux?.deleted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branching video (#144): the fork prompt and the transition it drives. The
// clock is the <video>'s own — the tests set duration/currentTime on the
// element and fire `timeupdate`, exactly what a playing stream does; the
// transition is asserted on the probe's initialize log: the SAME element,
// a new playbackId, no remount (the invariant that carries WebKit's
// autoplay blessing across the seam).
import { capturePostHog } from "@/lib/posthog-events";
import { onPixelReady } from "@/lib/meta-pixel-events";

// The overlays load through next/dynamic — under a full parallel run the
// lazy import can take longer than Testing Library's 1s default.
const LONG = { timeout: 5_000 };

function clock(video: HTMLVideoElement, duration: number) {
  let currentTime = 0;
  let ended = false;
  // jsdom's element reports `paused === true` (play() is a stub); the
  // refresh-hold test flips it to model a playing element.
  let paused = true;
  Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
  Object.defineProperty(video, "duration", { configurable: true, get: () => duration });
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    get: () => currentTime,
    set: (v: number) => {
      currentTime = v;
    },
  });
  Object.defineProperty(video, "ended", { configurable: true, get: () => ended });
  return {
    // Move the playhead and let the player's timeupdate consumers see it.
    seek: (t: number) =>
      act(() => {
        currentTime = t;
        video.dispatchEvent(new Event("timeupdate"));
      }),
    end: () =>
      act(async () => {
        currentTime = duration;
        ended = true;
        video.dispatchEvent(new Event("ended"));
      }),
    setPaused: (v: boolean) => {
      paused = v;
    },
  };
}

// Under fake timers Testing Library's waitFor cannot poll, so: advance the
// clock in small steps until the condition holds (or give up loudly).
async function advanceUntil(cond: () => boolean, stepMs = 50, maxSteps = 200) {
  for (let i = 0; i < maxSteps; i++) {
    if (cond()) return;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(stepMs);
    });
  }
  throw new Error(
    `advanceUntil: condition never held (inits=${probe.inits.map((i) => `${String(i.playbackId)}@${i.at}`).join(",")}, fetches=${tokenFetches().join(",")}, now=${Date.now()})`,
  );
}

const tokenFetches = () =>
  vi
    .mocked(fetch)
    .mock.calls.map(([input]) => String(input))
    .filter((u) => u.startsWith("/api/playback-token"))
    .map((u) => new URL(u, "http://localhost").searchParams.get("episode_id"));

const visibleVideo = () =>
  // The probe tags every MuxVideo (hidden preloaders included); the
  // slotted one is the player's.
  document.querySelector<HTMLVideoElement>('video[slot="media"]')!;

describe("Player — branching video (#144)", () => {
  beforeEach(() => {
    vi.mocked(capturePostHog).mockClear();
    vi.mocked(onPixelReady).mockClear();
    setConsent(false);
  });

  it.each(["horizontal", "vertical"] as const)(
    "[%s] prompt opens inside the window, the pick swaps in on the same element",
    async (orientation) => {
      mockViewport(orientation === "vertical");
      renderPlayer(orientation, { episodes: BRANCHING, initialEpisodeId: "ep-2" });
      const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
      await waitFor(() => expect(probe.inits).toHaveLength(1));
      expect(probe.inits[0].playbackId).toBe("pb-2");
      // The parent prints its own position…
      expect(screen.getAllByText(/Ep\. 2/).length).toBeGreaterThan(0);
      const c = clock(video, 600);

      // 50s from the end: nothing yet. 40s: every candidate's token is
      // prefetched, and only the DEFAULT's stream warms (preload=auto).
      // NB: `video[preload=…]` is readable here only because the probe
      // passes the prop through to the DOM; the real @mux/mux-video-react
      // (0.31.2) hands `preload` to playback-core's setPreload and puts no
      // attribute on the element. The assertion is about which candidate
      // the player marks warm, not about the DOM contract.
      c.seek(550);
      expect(tokenFetches()).toEqual(["ep-2"]);
      c.seek(560);
      await waitFor(() =>
        expect(tokenFetches()).toEqual(["ep-2", "b-901", "b-902"]),
      );
      await waitFor(() =>
        expect(document.querySelectorAll('video[preload="auto"]')).toHaveLength(1),
      );
      expect(document.querySelector('video[preload="metadata"]')).toBeNull();
      expect(screen.queryByRole("group", { name: en.forkOverlay.label })).toBeNull();

      // 8s from the end: the prompt is open, the default is focused and
      // tagged, the countdown reads the video clock, and the non-default
      // preloader mounts at preload=metadata.
      c.seek(592);
      const group = await screen.findByRole("group", { name: en.forkOverlay.label }, LONG);
      expect(group.textContent).toContain("Kiss him or hug him?");
      const kiss = screen.getByRole("button", { name: /kiss him/i });
      const hug = screen.getByRole("button", { name: /hug him/i });
      expect(document.activeElement).toBe(hug);
      expect(hug.textContent).toMatch(/auto/i);
      expect(screen.getByText(en.forkOverlay.autoIn(8))).toBeTruthy();
      await waitFor(() =>
        expect(document.querySelector('video[preload="metadata"]')).not.toBeNull(),
      );

      // The pick: pressed, and its preloader is promoted to a full warm-up
      // in place (the default's drops to metadata) — no remount of anything.
      const initsBefore = probe.inits.length;
      await act(async () => {
        kiss.click();
      });
      expect(kiss.getAttribute("aria-pressed")).toBe("true");
      expect(kiss.textContent).toMatch(/chosen/i);
      expect(hug.textContent).not.toMatch(/auto/i);
      expect(probe.inits).toHaveLength(initsBefore);
      const preloaders = [...document.querySelectorAll<HTMLVideoElement>("video")].filter(
        (v) => v !== video,
      );
      expect(preloaders.map((v) => [v.getAttribute("src"), v.getAttribute("preload")])).toEqual(
        expect.arrayContaining([
          ["https://stream.mux.com/pb-901.m3u8", "auto"],
          ["https://stream.mux.com/pb-902.m3u8", "metadata"],
        ]),
      );

      // The end: the branch installs on the SAME element with its
      // prefetched token — no extra token fetch, no remount — the prompt
      // closes, and the chrome keeps printing the parent's number.
      await c.end();
      await waitFor(() =>
        expect(probe.inits.some((i) => i.el === video && i.playbackId === "pb-901")).toBe(true),
      );
      expect(visibleVideo()).toBe(video);
      expect(tokenFetches()).toEqual(["ep-2", "b-901", "b-902"]);
      expect(screen.queryByRole("group", { name: en.forkOverlay.label })).toBeNull();
      expect(screen.getAllByText(/Ep\. 2/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/901/)).toBeNull();
      expect(nav.replace).toHaveBeenCalledWith(
        expect.stringContaining("ep=b-901"),
        expect.anything(),
      );
      expect(capturePostHog).toHaveBeenCalledWith("fork_choice_made", {
        show_slug: "the-scarlet-oath",
        episode_id: "ep-2",
        choice_position: 1,
        is_default: false,
        timed_out: false,
      });
      expect(capturePostHog).toHaveBeenCalledWith("episode_auto_advanced", {
        show_slug: "the-scarlet-oath",
        from_episode: 2,
        to_episode: 0,
      });
    },
  );

  it("nothing tapped: the default plays at the end, never a pause", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "ep-2" });
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    const c = clock(video, 600);
    c.seek(560);
    await waitFor(() => expect(tokenFetches()).toHaveLength(3));
    c.seek(595);
    await screen.findByRole("group", { name: en.forkOverlay.label }, LONG);
    expect(screen.getByText(en.forkOverlay.autoIn(5))).toBeTruthy();

    await c.end();
    await waitFor(() =>
      expect(probe.inits.some((i) => i.el === video && i.playbackId === "pb-902")).toBe(true),
    );
    expect(media.pause).not.toHaveBeenCalled();
    expect(capturePostHog).toHaveBeenCalledWith("fork_choice_made", {
      show_slug: "the-scarlet-oath",
      episode_id: "ep-2",
      choice_position: 2,
      is_default: true,
      timed_out: true,
    });
  });

  it("seeking back out of the window closes the prompt; the pick survives", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "ep-2" });
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    const c = clock(video, 600);
    c.seek(593);
    const kiss = await screen.findByRole("button", { name: /kiss him/i }, LONG);
    await act(async () => {
      kiss.click();
    });
    c.seek(500);
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: en.forkOverlay.label })).toBeNull(),
    );
    c.seek(594);
    const again = await screen.findByRole("button", { name: /kiss him/i }, LONG);
    expect(again.getAttribute("aria-pressed")).toBe("true");
  });

  it("a branch with one choice reconverges silently — no prompt, same element", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "b-901" });
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    expect(probe.inits[0].playbackId).toBe("pb-901");
    // A branch prints its parent's number, and its prev is that parent.
    expect(screen.getAllByText(/Ep\. 2/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/901/)).toBeNull();
    const c = clock(video, 600);
    c.seek(560);
    await waitFor(() => expect(tokenFetches()).toEqual(["b-901", "ep-3"]));
    c.seek(595);
    await act(async () => {});
    expect(screen.queryByRole("group", { name: en.forkOverlay.label })).toBeNull();

    await c.end();
    await waitFor(() =>
      expect(probe.inits.some((i) => i.el === video && i.playbackId === "pb-3")).toBe(true),
    );
    expect(capturePostHog).not.toHaveBeenCalledWith("fork_choice_made", expect.anything());
    expect(capturePostHog).toHaveBeenCalledWith("episode_auto_advanced", {
      show_slug: "the-scarlet-oath",
      from_episode: 0,
      to_episode: 3,
    });
    expect(screen.getAllByText(/Ep\. 3/).length).toBeGreaterThan(0);
  });

  it("a branch that is an ending reaches the series-end sheet and never fires Lead", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "b-931" });
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    const c = clock(video, 600);
    c.seek(560);
    await act(async () => {});
    // Nothing follows an ending — no prefetch at all.
    expect(tokenFetches()).toEqual(["b-931"]);
    await c.end();
    await screen.findByText(en.seriesEndOverlay.kicker, {}, LONG);
    expect(probe.inits).toHaveLength(1);
    expect(capturePostHog).not.toHaveBeenCalledWith("episode_auto_advanced", expect.anything());
    // Meta Lead is "finished the FIRST episode" — a branch is position 0.
    expect(onPixelReady).not.toHaveBeenCalled();
  });

  it("the last listed episode ends the show even though branches follow it in the array", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "ep-3" });
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    const c = clock(video, 600);
    await c.end();
    await screen.findByText(en.seriesEndOverlay.kicker, {}, LONG);
    expect(probe.inits).toHaveLength(1);
  });

  it("Lead fires at the end of episode 1 only", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "ep-1" });
    const video = (await screen.findByTestId("mux-video")) as HTMLVideoElement;
    await waitFor(() => expect(probe.inits).toHaveLength(1));
    const c = clock(video, 600);
    await c.end();
    expect(onPixelReady).toHaveBeenCalledTimes(1);
  });

  it("the token refresh is held on a PLAYING element inside the tail, lifts on pause, and never waits past its bound", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    try {
      // A 70s token: the refresh timer fires 10s after install (60s lead).
      vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/playback-token")) {
          const ep = new URL(url, "http://localhost").searchParams.get("episode_id");
          return {
            ok: true,
            status: 200,
            json: async () => ({ token: `tok-${ep}-${Date.now()}`, expiresIn: 70, mode: "member" }),
          } as unknown as Response;
        }
        throw new Error(`offline: ${url}`);
      });
      const ep2Fetches = () => tokenFetches().filter((id) => id === "ep-2").length;
      // The visible element's initializes only — inside the tail the hidden
      // preloaders (pb-901 / pb-902) initialize too.
      const ep2Inits = () => probe.inits.filter((i) => i.playbackId === "pb-2");

      renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "ep-2" });
      await advanceUntil(() => ep2Inits().length === 1);
      const first = ep2Inits()[0].el;
      expect(ep2Fetches()).toBe(1);

      // PAUSED inside the tail (5s from the end): the hold flag is up, but a
      // paused element is not held — the refresh fires on schedule (10s
      // after install) and remounts the element.
      const c1 = clock(first, 600);
      c1.seek(595);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      await advanceUntil(() => ep2Inits().length === 2);
      expect(ep2Fetches()).toBe(2);
      expect(ep2Inits()[1].el).not.toBe(first);

      // PLAYING inside the tail on the fresh element: the next refresh (10s
      // after the new token) waits — no fetch while the hold is up…
      const second = ep2Inits()[1].el;
      const c2 = clock(second, 600);
      c2.setPaused(false);
      c2.seek(595);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500);
      });
      expect(ep2Fetches()).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(ep2Fetches()).toBe(2);
      expect(ep2Inits()).toHaveLength(2);

      // …but the flag is only ever rewritten by timeupdate, so a stalled
      // clock would otherwise hold forever: past the bound (35s after the
      // timer fired) the refresh goes ahead regardless.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      await advanceUntil(() => ep2Fetches() === 3);
      await advanceUntil(() => ep2Inits().length === 3);
      expect(ep2Inits()[2].el).not.toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the episodes list shows the linear run only, with the parent as now playing during a branch", async () => {
    renderPlayer("horizontal", { episodes: BRANCHING, initialEpisodeId: "b-902" });
    await screen.findByTestId("mux-video");
    await act(async () => {
      screen.getByRole("button", { name: en.player.episodesBtn }).click();
    });
    const dialog = await screen.findByRole("dialog", { name: en.episodesOverlay.title }, LONG);
    expect(dialog.textContent).toContain(en.episodesOverlay.count(3));
    expect(dialog.textContent).not.toContain("902");
    expect(dialog.textContent).not.toContain("hugs him");
    // The "now playing" marker sits on episode 2 — the one the branch continues.
    const rows = [...dialog.querySelectorAll("li")];
    const playing = rows.find((li) => li.textContent?.includes(en.episodesOverlay.nowPlaying));
    expect(playing?.textContent).toContain("2. Episode 2");
  });
});
