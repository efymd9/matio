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
      probe.inits.push({ el, playbackId, envKey, disableTracking, disableCookies });
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

const EPISODES: PlayerEpisode[] = [1, 2].map((n) => ({
  id: `ep-${n}`,
  number: n,
  seasonNumber: 1,
  title: `Episode ${n}`,
  description: null,
  durationSeconds: 600,
  playbackId: `pb-${n}`,
  introStartSeconds: null,
  introEndSeconds: null,
  thumbnailUrl: null,
  tier: "free",
}));

function renderPlayer(orientation: "horizontal" | "vertical" = "horizontal") {
  return render(
    <Player
      episodes={EPISODES}
      initialEpisodeId="ep-1"
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
