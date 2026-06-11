"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import MuxVideo from "@mux/mux-video-react";
import { canAutoplayMuted } from "@/lib/can-autoplay";
import { useMarketingConsent } from "@/lib/use-marketing-consent";
import { useVerticalLayout } from "@/lib/use-vertical-layout";
import { VerticalChrome } from "./vertical-chrome";

// Public Mux Data env key (distinct from the API token / signing key). Empty
// when unset → Mux Data stays fully off.
const MUX_DATA_ENV_KEY = process.env.NEXT_PUBLIC_MUX_DATA_ENV_KEY ?? "";
import {
  MediaAirplayButton,
  MediaCaptionsButton,
  MediaController,
  MediaFullscreenButton,
  MediaMuteButton,
  MediaPlayButton,
  MediaPlaybackRateButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
} from "media-chrome/react";
import {
  MediaRenditionMenu,
  MediaRenditionMenuButton,
} from "media-chrome/react/menu";
import { Icon } from "@/components/site/icon";
import { MatioLogo } from "@/components/site/matio-logo";
import { useT } from "@/lib/i18n/client";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog } from "@/lib/posthog-events";
import dynamic from "next/dynamic";
import { saveTrialPosition, saveWatchProgress } from "@/app/watch/actions";

const Paywall = dynamic(() => import("./paywall").then((m) => m.Paywall), {
  ssr: false,
});
const PlaybackUnavailable = dynamic(
  () => import("./playback-status").then((m) => m.PlaybackUnavailable),
  { ssr: false },
);
const RateLimitedNotice = dynamic(
  () => import("./playback-status").then((m) => m.RateLimitedNotice),
  { ssr: false },
);
const EpisodesOverlay = dynamic(
  () => import("./episodes-overlay").then((m) => m.EpisodesOverlay),
  { ssr: false },
);
const UpNextOverlay = dynamic(
  () => import("./up-next-overlay").then((m) => m.UpNextOverlay),
  { ssr: false },
);
const SeriesEndOverlay = dynamic(
  () => import("./series-end-overlay").then((m) => m.SeriesEndOverlay),
  { ssr: false },
);
const SignupWall = dynamic(
  () => import("./signup-wall").then((m) => m.SignupWall),
  { ssr: false },
);

export type PlayerEpisode = {
  id: string;
  number: number;
  seasonNumber: number;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  playbackId: string;
  introStartSeconds: number | null;
  introEndSeconds: number | null;
  // Server-signed Mux thumbnail URL. Null on assets that haven't been
  // provisioned yet or when minting fails — overlays fall back to a
  // tone-gradient placeholder.
  thumbnailUrl: string | null;
  // Access tier on episode-gated shows; "free" everywhere on legacy shows.
  tier: EpisodeTier;
};

// Tier of an episode on an episode-gated show, as computed server-side by
// lib/episode-access.ts (which is server-only and can't be imported here —
// this is the structural client-side mirror). Legacy shows pass "free" for
// every episode so nothing ever renders locked.
export type EpisodeTier = "free" | "member" | "subscriber";

export type Mode = "subscriber" | "trial" | "free" | "member";

// Video shape of the show (db `shows.orientation`). "vertical" switches to the
// portrait/TikTok chrome on mobile-width viewports; "horizontal" (default) and
// any desktop viewport keep the standard player. Mirrors the server enum so
// this client module needs no server-only import.
export type ShowOrientation = "horizontal" | "vertical";

// Whether `mode` may play an episode of `tier`. Subscriber and legacy-trial
// modes never lock (trial gating is the 60s clock, not position).
export function isEpisodeLocked(tier: EpisodeTier, mode: Mode): boolean {
  if (mode === "subscriber" || mode === "trial") return false;
  if (mode === "member") return tier === "subscriber";
  return tier !== "free"; // mode === "free"
}

type OverlayKind = "none" | "episodes" | "upnext" | "seriesEnd";

// End-states for the player. Distinct from a transient error: once we
// hit one of these, the <MediaController> stops rendering and a focused
// overlay takes over the slot.
//
// - paywall: trial preview ended naturally (token route 403). Shows the
//   plan-picker sheet. Reserved for this exact case — using it for
//   anything else (rate limit, server error, decode failure) frames
//   infrastructure problems as a payment issue.
// - rateLimited: too many trial starts from this IP/show bucket in the
//   last hour (429). Distinct visuals, still offers subscribe.
// - unavailable: anything else — 5xx, network failure, malformed
//   response, video decode error. Retryable.
const SUPPORTS_ASPECT_RATIO =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("aspect-ratio", "16 / 9");

// How long before the current episode ends we prefetch the next episode's
// token and start warming its stream. 45s gives the hidden preloader time
// to fill its ~30s forward buffer (hls.js default maxBufferLength) — Mux
// serves media segments with week-long deterministic cache URLs, so the
// preloader's fetches become browser-cache hits for the visible player.
const PRELOAD_LEAD_SECONDS = 45;

type EndState = "paywall" | "signupWall" | "rateLimited" | "unavailable";

// 403s on gated shows carry a reason ("signup_required" /
// "subscribe_required"); legacy trial 403s have none and keep mapping to
// the trial paywall. Body parse failures fall back the same way.
async function classifyTokenFailure(r: Response): Promise<EndState> {
  if (r.status === 429) return "rateLimited";
  if (r.status === 403) {
    try {
      const body = (await r.json()) as { reason?: unknown };
      if (body.reason === "signup_required") return "signupWall";
    } catch {
      // fall through
    }
    return "paywall";
  }
  return "unavailable";
}

// Outer shell owns episode selection, overlay visibility, and the locked
// flag — none of which should reset on episode swap. The inner
// EpisodePlayback is keyed on mountKey: manual swaps bump it, so they
// unmount and remount the inner player, which is what naturally resets
// per-episode state (token, paywall, aspect ratio, captions, skip-intro,
// last-saved position) without needing setState calls at the top of
// effects. Auto-advance at episode end deliberately does NOT bump it —
// the underlying <video> element must survive the transition because
// WebKit's autoplay blessing is per-element (a remounted element can't
// continue playing unmuted without a fresh gesture); the inner component
// resets its per-episode state explicitly for that one path.
export function Player({
  episodes,
  initialEpisodeId,
  mode,
  showId,
  showSlug,
  showTitle,
  resumeSeconds,
  userEmail,
  autoplay = true,
  payFirst = false,
  orientation = "horizontal",
}: {
  episodes: PlayerEpisode[];
  initialEpisodeId: string;
  mode: Mode;
  showId: string;
  showSlug: string;
  showTitle?: string;
  resumeSeconds?: number | null;
  // Pre-fill for the SeriesEndOverlay reminder form. Null for trial
  // users and any case where we couldn't resolve a user email.
  userEmail?: string | null;
  // False for crawlers (server-side userAgent().isBot): keeps the poster
  // play-gate so bots never trigger the token fetch that mints trial rows.
  autoplay?: boolean;
  // PAY_FIRST_CHECKOUT flag (server-read on the watch page): the paywall's
  // signed-out CTA goes straight to guest Stripe Checkout.
  payFirst?: boolean;
  // Show's video shape — vertical shows get the portrait chrome on mobile.
  orientation?: ShowOrientation;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [currentEpisodeId, setCurrentEpisodeId] = useState(initialEpisodeId);
  // Bumped on manual swaps only — see the component comment above.
  const [mountKey, setMountKey] = useState(0);
  // Server-provided resume must only ever apply to the episode this mount
  // started on. BOTH halves are snapshotted from the first render: the
  // props change together after a swap/advance (router.replace re-renders
  // the page with ?ep=<new id>, recomputing resumeSeconds for THAT
  // episode), so freezing only the id would pair it with another
  // episode's live offset — seeking ep1 to ep2's position on swap-back.
  const [initialResume] = useState(() => ({
    id: initialEpisodeId,
    seconds: resumeSeconds ?? null,
  }));
  const [overlay, setOverlay] = useState<OverlayKind>("none");
  const [locked, setLocked] = useState(false);
  // trial_play_started (PostHog) fires once per show-preview session, not per
  // episode — the ref lives in the outer shell so swapping episodes mid-trial
  // doesn't re-fire it. No-op without marketing consent (PostHog isn't loaded).
  const trialStartFiredRef = useRef(false);
  const onTrialStart = useCallback(() => {
    if (trialStartFiredRef.current) return;
    trialStartFiredRef.current = true;
    capturePostHog("trial_play_started", {
      show_slug: showSlug,
      show_title: showTitle ?? showSlug,
    });
  }, [showTitle, showSlug]);

  // Meta ViewContent = "started watching" (2026-06-10 funnel mapping:
  // ViewContent → Lead at paywall → InitiateCheckout → Purchase). Fires on
  // the first real playing frame — NOT page land or token issuance, so
  // blocked-autoplay sessions and crawlers never count — once per player
  // mount, any mode. Deferred onto the consent-gated pixel; without consent
  // the listener never fires.
  const viewContentFiredRef = useRef(false);
  const onFirstPlay = useCallback(() => {
    if (viewContentFiredRef.current) return;
    viewContentFiredRef.current = true;
    onPixelReady(() => {
      trackPixel("ViewContent", {
        content_type: "product",
        content_ids: [showSlug],
        content_name: showTitle ?? showSlug,
      });
    });
  }, [showSlug, showTitle]);

  const current = useMemo(
    () => episodes.find((e) => e.id === currentEpisodeId) ?? episodes[0],
    [episodes, currentEpisodeId],
  );
  const currentIdx = episodes.findIndex((e) => e.id === current.id);
  const next: PlayerEpisode | null =
    currentIdx >= 0 && currentIdx < episodes.length - 1
      ? episodes[currentIdx + 1]
      : null;

  // Only honor server-provided resume on the episode this mount started
  // on; subsequent swaps/advances start from 0 by design.
  const resumeForThisLoad =
    current.id === initialResume.id ? initialResume.seconds : null;

  // Reflect an episode change in the URL so refresh/share lands on it,
  // stripping ?resume= (it only applies to the initial render).
  const updateUrl = useCallback(
    (episodeId: string) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      sp.set("ep", episodeId);
      sp.delete("resume");
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Swap to a different episode — updates the URL, closes any open
  // overlay, and triggers the inner remount via the key change.
  const swap = useCallback(
    (episodeId: string) => {
      if (episodeId === currentEpisodeId) {
        setOverlay("none");
        return;
      }
      setCurrentEpisodeId(episodeId);
      setMountKey((k) => k + 1);
      setOverlay("none");
      updateUrl(episodeId);
    },
    [currentEpisodeId, updateUrl],
  );

  // Auto-advance at episode end — same as swap but WITHOUT the remount:
  // the inner player keeps its <video> element and installs the new
  // episode via a src change (per-episode state resets explicitly there).
  const advance = useCallback(
    (episodeId: string) => {
      setCurrentEpisodeId(episodeId);
      setOverlay("none");
      updateUrl(episodeId);
    },
    [updateUrl],
  );

  return (
    <EpisodePlayback
      key={mountKey}
      current={current}
      next={next}
      episodes={episodes}
      mode={mode}
      showId={showId}
      showSlug={showSlug}
      showTitle={showTitle}
      resumeSeconds={resumeForThisLoad}
      autoplay={autoplay}
      locked={locked}
      onLockChange={setLocked}
      overlay={overlay}
      onOverlayChange={setOverlay}
      onSwap={swap}
      onAdvance={advance}
      onTrialStart={onTrialStart}
      onFirstPlay={onFirstPlay}
      userEmail={userEmail}
      payFirst={payFirst}
      orientation={orientation}
    />
  );
}

function EpisodePlayback({
  current,
  next,
  episodes,
  mode,
  showId,
  showSlug,
  showTitle,
  resumeSeconds,
  autoplay,
  locked,
  onLockChange,
  overlay,
  onOverlayChange,
  onSwap,
  onAdvance,
  onTrialStart,
  onFirstPlay,
  userEmail,
  payFirst,
  orientation,
}: {
  current: PlayerEpisode;
  next: PlayerEpisode | null;
  episodes: PlayerEpisode[];
  mode: Mode;
  showId: string;
  showSlug: string;
  showTitle?: string;
  resumeSeconds: number | null;
  autoplay: boolean;
  locked: boolean;
  onLockChange: (locked: boolean) => void;
  overlay: OverlayKind;
  onOverlayChange: (overlay: OverlayKind) => void;
  onSwap: (episodeId: string) => void;
  onAdvance: (episodeId: string) => void;
  onTrialStart: () => void;
  onFirstPlay: () => void;
  userEmail?: string | null;
  payFirst?: boolean;
  orientation: ShowOrientation;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const t = useT();
  // Portrait/TikTok chrome — only for vertical shows on mobile-width
  // viewports (desktop keeps the standard letterboxing player). Drives the
  // container sizing and which chrome renders below; nothing in the playback
  // engine, token lifecycle, or element-identity strategy changes.
  const verticalLayout = useVerticalLayout(orientation);
  // Mux Data (watch-time/QoE analytics) is gated on marketing consent AND a
  // configured env key. Until both hold we pass disableTracking/disableCookies
  // so no beacons or viewer-id cookies fire — this also closes the pre-consent
  // telemetry leak. <MuxVideo> only renders client-side (after the token
  // effect), so the consent value is settled before it mounts.
  const marketingConsent = useMarketingConsent();
  const muxDataEnabled = marketingConsent && !!MUX_DATA_ENV_KEY;
  // Mirrored ref + state: ref handles the fast tick comparison inside the
  // 10s interval (avoids re-creating the interval on every save), state
  // is what the paywall branch reads (refs can't be accessed in render).
  const lastSavedRef = useRef(0);
  const [lastSaved, setLastSaved] = useState(0);
  // Active playback snapshot: which episode the <video> is (or is about to
  // be) playing, plus the token minted FOR that episode. The three travel
  // together because a Mux JWT is signed per playback id — handing
  // <MuxVideo> a new playbackId alongside a stale token would 403 every
  // segment request. Null until the first token fetch resolves.
  const [playback, setPlayback] = useState<{
    episodeId: string;
    playbackId: string;
    token: string;
    expiresAt: number;
  } | null>(null);
  const [endState, setEndState] = useState<EndState | null>(null);
  // Whether this session should attempt autoplay at all. The attempt
  // itself is owned by the first-play effect below (NOT <MuxVideo
  // autoPlay> — playback-core's "any" chain retries muted on ANY play()
  // rejection, including the AbortError a user's own startup pause fires).
  const autoplayWanted = autoplay || mode === "trial" || mode === "free";
  // subscriber/member fetch a token on mount unconditionally (no row mint
  // to protect). trial/free wait for the autoplay-capability probe below:
  // capable sessions start on land — the 60s trial clock begins together
  // with playback, the explicit product choice — while blocked sessions
  // (iOS Low Power Mode etc.) keep the poster play-gate so the clock
  // can't burn with zero frames rendered. Crawlers stay gated forever.
  const [started, setStarted] = useState(
    mode === "subscriber" || mode === "member",
  );
  // "pending" while the muted-autoplay probe runs (trial/free humans only);
  // "blocked" renders the poster gate; "allowed" flips `started`.
  const [autoplayProbe, setAutoplayProbe] = useState<
    "pending" | "allowed" | "blocked"
  >(() =>
    mode === "subscriber" || mode === "member"
      ? "allowed"
      : autoplay
        ? "pending"
        : "blocked",
  );
  // True once the user has actually interacted with the player surface
  // (poster-gate tap, tap-to-play). A pre-gesture rate-limit 429 degrades
  // to the poster gate instead of a full-surface error.
  const hadGestureRef = useRef(false);
  // Set on the element's `pause` event — which only fires for real pauses
  // (user/scripted) and the natural-end transition (reset in onEnded), so
  // the autoplay-block probe can tell "blocked" from "user chose to pause".
  const pausedByUserRef = useRef(false);
  // True when the muted state was OUR doing (the first-play chain's
  // NotAllowedError fallback) rather than the user's (persisted
  // media-chrome mute pref, manual mute). Only fallback-muting earns the
  // unmute pill. A ref written by the chain itself — an event-timing
  // snapshot (e.g. on loadstart) loses the race, because the play()
  // rejection mutes in a microtask before any media event fires.
  const mutedByFallbackRef = useRef(false);
  // Bumped by retry() — included in the token-fetch effect's deps so the
  // fetch reruns without unmounting the inner playback component (which
  // would also tear down the MediaController and any captured renditions).
  const [fetchKey, setFetchKey] = useState(0);
  const retry = useCallback(() => {
    // The retry button IS a gesture — a 429 on the retried fetch should
    // surface the honest RateLimitedNotice, not the poster-gate fallback.
    hadGestureRef.current = true;
    setEndState(null);
    setPlayback(null);
    setFetchKey((k) => k + 1);
  }, []);
  // <MuxVideo> remount key for subscriber token REFRESHES only (the wrapper
  // ignores tokens-only prop changes, so a refreshed token can't reach
  // hls.js without a remount). Auto-advance must NOT bump it: an episode
  // change flips playbackId, which the wrapper handles in place on the same
  // <video> element — and that element identity is what carries WebKit's
  // per-element autoplay blessing from one episode into the next.
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Prefetched token for the next episode, fetched shortly before the
  // current one ends so auto-advance skips the token round-trip. `mode`
  // carries the response's tier so the gapless install can fire the
  // free/member episode-start funnel events (the fetch effect — their
  // usual emitter — is skipped on that path).
  const [nextPrefetch, setNextPrefetch] = useState<{
    episodeId: string;
    token: string;
    expiresAt: number;
    mode: "free" | "member" | null;
  } | null>(null);
  // One prefetch attempt per episode; reset in the onEnded advance path.
  const prefetchAttemptedRef = useRef(false);
  // "Tap for sound" pill — autoplay landed in the muted fallback.
  const [showUnmutePill, setShowUnmutePill] = useState(false);
  // Autoplay fully blocked (e.g. iOS Low Power Mode): playback-core leaves
  // the element paused with no signal, so we detect it and surface a
  // tap-to-play affordance ourselves.
  const [needsTap, setNeedsTap] = useState(false);
  // Transient "Up next" chip shown right after an auto-advance.
  const [chipEpisodeId, setChipEpisodeId] = useState<string | null>(null);
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  // Whether the underlying media element exposes at least one real
  // caption/subtitle track. media-chrome's built-in auto-hide on
  // <MediaCaptionsButton> doesn't catch every case (Mux sometimes surfaces
  // empty/CEA-608 placeholders), so we gate the button on our own check.
  const [hasCaptions, setHasCaptions] = useState(false);
  // Live aspect ratio of the playing asset, read off the video element
  // once metadata is available. Seed from the show's orientation (9:16 for
  // vertical, 16:9 otherwise) so the first paint already matches the asset's
  // shape — a vertical show on desktop no longer reflows from a wide box to a
  // tall one when the manifest arrives. Still corrected from the real
  // videoWidth/videoHeight on loadedmetadata for non-standard ratios.
  const [aspectRatio, setAspectRatio] = useState<number>(
    orientation === "vertical" ? 9 / 16 : 16 / 9,
  );
  const supportsAspectRatio = SUPPORTS_ASPECT_RATIO;
  // Rolling timestamps of recent video <error> events. A single decode
  // hiccup on cellular is normal noise; we only surrender the slot to
  // PlaybackUnavailable when 3 errors land inside a 10s window.
  const errorTimesRef = useRef<number[]>([]);
  // Subscriber token-refresh remounts <MuxVideo> (keyed on refreshNonce)
  // because the wrapper only rebuilds its HLS src on a playbackId change,
  // never on a tokens-only change — so a refreshed token can't reach hls.js
  // otherwise.
  // Capture playhead + play-state before the swap and restore them on the new
  // element's loadedmetadata so the remount is seamless. Trial tokens are never
  // refreshed, so this only fires for subscribers (~once an hour).
  const resumeAfterRefreshRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  // The refresh remount creates a fresh element (muted=false by default) —
  // a fallback-muted session never wrote media-chrome's mute pref, so the
  // muted state must be carried across explicitly.
  const mutedAtRefreshRef = useRef<boolean | null>(null);
  // first_frame fires once per episode mount when playback actually starts, so
  // we can tell "play attempted but never rendered" from "actually played".
  const firstFrameFiredRef = useRef(false);

  const episodeLabel = `S${current.seasonNumber}·E${current.number}`;

  // 1-based position of the current episode in the playable ordering —
  // matches the server's position semantics for funnel events.
  const currentPosition = episodes.findIndex((e) => e.id === current.id) + 1;
  // Whether the current episode is above this viewer's tier. All wall
  // triggers (deep link, episodes-overlay tap, auto-advance into a locked
  // episode) funnel through here: swapping to a locked episode remounts
  // this component, which renders the wall full-surface instead of
  // fetching a token.
  const currentLocked = isEpisodeLocked(current.tier, mode);
  const firstMemberEpisode = episodes.find((e) => e.tier === "member") ?? null;
  const memberCount = episodes.filter((e) => e.tier === "member").length;
  // free/member episode-start funnel events fire once per episode mount.
  const tierStartFiredRef = useRef(false);

  // Tracks prop-driven episode changes for the render-phase reset below.
  const [prevEpisodeId, setPrevEpisodeId] = useState(current.id);

  // Gapless auto-advance: when the outer shell advances the episode WITHOUT
  // remounting (the onEnded path), per-episode state resets here, during
  // render — React's "adjust state when props change" pattern. An effect
  // would trip react-hooks/set-state-in-effect, and a keyed remount would
  // discard the <video> element along with its per-element autoplay
  // blessing (WebKit) — see the Player shell comment. The prefetched-token
  // installation and all ref resets live in the onEnded handler (event
  // context — render must stay pure); this block is visual-state cleanup
  // only.
  if (current.id !== prevEpisodeId) {
    setPrevEpisodeId(current.id);
    // A leftover prefetch here belongs to a previous episode's "next" (the
    // advance path already consumed and cleared its own) — drop it.
    if (nextPrefetch) setNextPrefetch(null);
    setEndState(null);
    setLastSaved(0);
    setShowSkipIntro(false);
    setHasCaptions(false);
    setNeedsTap(false);
  }

  // Trial/free autoplay gate: wait until the tab is actually visible, then
  // probe whether muted autoplay is permitted (lib/can-autoplay.ts).
  // Capable sessions start on land — the token fetch mints the row at the
  // same moment playback begins. Blocked sessions keep the poster gate so
  // the 60s clock can't burn unwatched, and background-tab lands don't
  // mint at all until the tab is foregrounded.
  useEffect(() => {
    if (autoplayProbe !== "pending" || started) return;
    let cancelled = false;
    const probe = () => {
      document.removeEventListener("visibilitychange", onVisible);
      void canAutoplayMuted().then((ok) => {
        if (cancelled) return;
        setAutoplayProbe(ok ? "allowed" : "blocked");
        if (ok) setStarted(true);
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") probe();
    };
    if (document.visibilityState === "visible") probe();
    else document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [autoplayProbe, started]);

  // Fetch playback token. Gated on `started` — set on mount for
  // subscriber/member, by the autoplay probe for capable trial/free
  // sessions, and by the poster-gate tap otherwise — so the token (and, in
  // trial mode, the 60s clock) starts together with playback.
  // Skipped while the active snapshot already belongs to this episode
  // (prefetched auto-advance installs it during render; a subscriber token
  // refresh updates it in place). Branches on response status so that a
  // 429 / 5xx / parse failure doesn't get framed as a "preview ended"
  // paywall. AbortController cancels the in-flight fetch on episode swap so
  // a slow response can't race the new episode's fetch.
  useEffect(() => {
    if (!started || currentLocked) return;
    if (playback && playback.episodeId === current.id) return;
    const episodeId = current.id;
    const playbackId = current.playbackId;
    const hasAbort = typeof AbortController !== "undefined";
    const abort = hasAbort ? new AbortController() : null;
    let cancelled = false;
    fetch(
      `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
      { cache: "no-store", ...(abort ? { signal: abort.signal } : {}) },
    )
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          const failure = await classifyTokenFailure(r);
          if (cancelled) return;
          if (
            failure === "rateLimited" &&
            mode === "trial" &&
            !hadGestureRef.current
          ) {
            // Pre-gesture 429: the mount fetch lost the IP-bucket race to
            // other landers (CGNAT, ad webviews). Don't present a
            // full-surface error to someone who hasn't touched anything —
            // fall back to the poster gate; a real tap re-attempts and
            // only then surfaces the honest rate-limit notice.
            setStarted(false);
            setAutoplayProbe("blocked");
            return;
          }
          setEndState(failure);
          return;
        }
        try {
          const data = (await r.json()) as {
            token: unknown;
            expiresIn: unknown;
            mode?: unknown;
          };
          if (cancelled) return;
          if (
            typeof data.token !== "string" ||
            typeof data.expiresIn !== "number"
          ) {
            setEndState("unavailable");
            return;
          }
          setPlayback({
            episodeId,
            playbackId,
            token: data.token,
            expiresAt: Date.now() + data.expiresIn * 1000,
          });
          // trial_play_started deliberately does NOT fire here anymore —
          // it fires on the first `playing` frame (onPlaying) so the saved
          // PostHog funnels keep meaning "started watching", not "token
          // minted on land".
          if (
            (data.mode === "free" || data.mode === "member") &&
            !tierStartFiredRef.current
          ) {
            tierStartFiredRef.current = true;
            capturePostHog(
              data.mode === "free"
                ? "free_episode_started"
                : "member_episode_started",
              { show_slug: showSlug, episode_number: currentPosition },
            );
          }
        } catch {
          if (!cancelled) setEndState("unavailable");
        }
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (!cancelled) setEndState("unavailable");
      });
    return () => {
      cancelled = true;
      abort?.abort();
    };
  }, [
    current.id,
    current.playbackId,
    playback,
    fetchKey,
    mode,
    started,
    currentLocked,
    showSlug,
    currentPosition,
  ]);

  // Token lifecycle after the first successful fetch:
  //
  //  - Subscriber tokens (1h TTL) auto-refresh REFRESH_LEAD_MS before
  //    expiry. Refreshing exactly at expiry raced segment fetches that ran
  //    a hair late — Mux validates `exp` per-segment, so a stale token meant
  //    a 403 mid-playback. The lead window lets the new token install while
  //    the old one still works. 4xx (paywall/rate-limit) is terminal; 5xx
  //    and network errors retry with exponential backoff (3 attempts) before
  //    the unavailable end-state. We never pause on failure — the existing
  //    token may still have time on it.
  //
  //  - Trial tokens (60s TTL) are NOT refreshed. The lead window (60s) is the
  //    entire TTL, so the old `wait = expiresAt - now - lead` collapsed to ~0:
  //    the refresh fired immediately, set a new expiresAt ~60s out, and — since
  //    expiresAt is a dep — re-armed and fired again every network round-trip,
  //    a tight loop that re-minted the token hundreds of times per preview
  //    (and, because @mux/mux-video-react only re-derives its src on a
  //    playbackId change, the refreshed token never even reached the player).
  //    A trial preview is meant to end at the paywall, so we just schedule a
  //    single transition to it at the token's expiry.
  useEffect(() => {
    if (!playback) return;
    const REFRESH_LEAD_MS = 60_000;
    const remaining = playback.expiresAt - Date.now();
    // Refresh the token the snapshot was minted for — during an
    // un-prefetched auto-advance the snapshot briefly trails current.id,
    // and a refresh for the wrong episode would 403-or-replace it.
    const { episodeId, playbackId } = playback;

    // Short-lived token => trial. Don't refresh; end the preview at expiry.
    // (Subscriber refreshes always re-arm with a fresh ~1h expiresAt, so they
    // never fall into this branch.)
    if (remaining <= REFRESH_LEAD_MS + 5_000) {
      if (mode !== "trial") return;
      const endTimer = setTimeout(
        () => setEndState("paywall"),
        Math.max(0, remaining),
      );
      return () => clearTimeout(endTimer);
    }

    const wait = remaining - REFRESH_LEAD_MS;
    const hasAbort = typeof AbortController !== "undefined";
    const abort = hasAbort ? new AbortController() : null;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const backoffs = [0, 1_000, 2_000, 4_000];
      for (let i = 0; i < backoffs.length; i++) {
        if (cancelled) return;
        if (backoffs[i] > 0) {
          await new Promise((r) => setTimeout(r, backoffs[i]));
          if (cancelled) return;
        }
        try {
          const r = await fetch(
            `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
            { cache: "no-store", ...(abort ? { signal: abort.signal } : {}) },
          );
          if (r.ok) {
            if (cancelled) return;
            const data = (await r.json()) as {
              token: unknown;
              expiresIn: unknown;
            };
            if (cancelled) return;
            if (
              typeof data.token === "string" &&
              typeof data.expiresIn === "number"
            ) {
              // Capture playhead + play-state before the token swap remounts
              // <MuxVideo> (key={refreshNonce}); restored on its
              // loadedmetadata. The old token is still valid here (we're
              // REFRESH_LEAD_MS ahead of expiry), so playback keeps running
              // until React commits the new element. The nonce remount is
              // required because the wrapper ignores tokens-only changes —
              // and it's the ONLY remaining remount of a live element.
              const el = videoRef.current;
              if (el) {
                resumeAfterRefreshRef.current = el.currentTime;
                wasPlayingRef.current = !el.paused;
                mutedAtRefreshRef.current = el.muted;
              }
              setPlayback({
                episodeId,
                playbackId,
                token: data.token,
                expiresAt: Date.now() + data.expiresIn * 1000,
              });
              setRefreshNonce((n) => n + 1);
              return;
            }
            setEndState("unavailable");
            return;
          }
          if (r.status >= 400 && r.status < 500) {
            setEndState(await classifyTokenFailure(r));
            return;
          }
          // 5xx — fall through to retry.
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") return;
          // Network — fall through to retry.
        }
      }
      if (!cancelled) setEndState("unavailable");
    }, wait);
    return () => {
      cancelled = true;
      abort?.abort();
      clearTimeout(timer);
    };
  }, [playback, mode]);

  // Save progress every 10s while playing AND visible. On tab hide
  // (visibilitychange/pagehide) we flush a final save immediately —
  // otherwise mobile users lose up to 10s every time they background
  // the app. Skipping ticks while hidden also saves battery on long
  // backgrounded tabs.
  useEffect(() => {
    const flush = () => {
      const el = videoRef.current;
      if (!el) return;
      // Mid-auto-advance the element still holds the PREVIOUS episode
      // (snapshot trails current.id) — saving would cross-write the old
      // playhead under the new id. The ended check alone isn't enough: a
      // seek or replay during the gap un-ends the element.
      if (!playback || playback.episodeId !== current.id) return;
      // An ended element was already final-saved by onEnded.
      if (el.ended) return;
      const t = Math.floor(el.currentTime ?? 0);
      if (t > 0 && t !== lastSavedRef.current) {
        lastSavedRef.current = t;
        setLastSaved(t);
        if (mode === "trial" || mode === "free") {
          void saveTrialPosition(current.id, t).catch(() => {});
        } else {
          void saveWatchProgress(current.id, t, false).catch(() => {});
        }
      }
    };
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const el = videoRef.current;
      if (!el || el.paused) return;
      flush();
    }, 10_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [current.id, mode, playback]);

  // Seek to resume position once the player has metadata for the episode.
  // This is the server-provided resume and applies only on the initial episode
  // load. A subscriber token-refresh remount also re-runs this effect (deps
  // include playback), but its playhead is owned by resumeAfterRefreshRef in
  // onLoadedMetadata — skip here when that restore is pending so we don't yank a
  // mid-playback viewer back toward the original resume point.
  useEffect(() => {
    if (resumeAfterRefreshRef.current != null) return;
    if (!playback || !resumeSeconds || resumeSeconds <= 0) return;
    const el = videoRef.current;
    if (!el) return;
    const handler = () => {
      if ((el.currentTime ?? 0) < resumeSeconds) {
        el.currentTime = resumeSeconds;
      }
    };
    el.addEventListener("loadedmetadata", handler, { once: true });
    return () => el.removeEventListener("loadedmetadata", handler);
  }, [playback, resumeSeconds]);

  // Detect real caption/subtitle tracks on the underlying media element so
  // we can decide whether to render the CC button. The textTracks list is
  // populated asynchronously by HLS as the manifest parses, so we both
  // poll once and subscribe to add/remove events. The check() runs at the
  // top of the effect and sets the correct value, so no reset is needed.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const check = () => {
      const tracks = Array.from(el.textTracks);
      // CEA-608 inline tracks show up as kind="captions" with no label and
      // are often noisy/empty on Mux. We accept either kind but require a
      // language hint so empty placeholders don't activate the button.
      const real = tracks.some(
        (t) =>
          (t.kind === "captions" || t.kind === "subtitles") && !!t.language,
      );
      setHasCaptions(real);
    };
    check();
    const onAdd = () => check();
    el.textTracks.addEventListener?.("addtrack", onAdd);
    el.textTracks.addEventListener?.("removetrack", onAdd);
    return () => {
      el.textTracks.removeEventListener?.("addtrack", onAdd);
      el.textTracks.removeEventListener?.("removetrack", onAdd);
    };
  }, [playback]);

  // Skip-intro chip — visible while currentTime falls inside the episode's
  // intro window. Only activates when both markers are present (admin-set
  // in the episode edit form). When markers are missing the effect bails
  // immediately; showSkipIntro starts false on this mount so no reset.
  useEffect(() => {
    const start = current.introStartSeconds;
    const end = current.introEndSeconds;
    if (start == null || end == null || end <= start) return;
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      const t = el.currentTime ?? 0;
      setShowSkipIntro(t >= start && t < end);
    };
    update();
    el.addEventListener("timeupdate", update);
    return () => el.removeEventListener("timeupdate", update);
  }, [current.introStartSeconds, current.introEndSeconds, playback]);

  // First-play attempt — owned here rather than via <MuxVideo autoPlay>:
  // playback-core's "any" chain retries muted on ANY play() rejection,
  // including the AbortError fired when the USER pauses during startup,
  // which force-resumed them muted. We retry muted only on NotAllowedError
  // (a genuine policy block). Armed per snapshot install, and re-fired on
  // loadstart, so it covers page-land, auto-advance src swaps, and
  // token-refresh remounts alike.
  useEffect(() => {
    if (!playback || playback.episodeId !== current.id) return;
    if (!autoplayWanted) return;
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;
    const attempt = () => {
      // el.ended: an auto-advance just fired off this element's old src —
      // playing it again would visibly rewind the finished episode while
      // the wrapper tears it down. The new src's loadstart re-attempts.
      // pausedByUser: a startup pause must stick even across later
      // re-triggers (e.g. the hourly token-refresh remount).
      if (cancelled || firstFrameFiredRef.current) return;
      if (!el.paused || el.ended || pausedByUserRef.current) return;
      el.play().catch((err: unknown) => {
        if (cancelled) return;
        if ((err as { name?: string })?.name !== "NotAllowedError") return;
        const wasMuted = el.muted;
        el.muted = true;
        mutedByFallbackRef.current = true;
        el.play().catch(() => {
          if (!cancelled) {
            el.muted = wasMuted;
            mutedByFallbackRef.current = false;
          }
        });
      });
    };
    // The wrapper may have already installed the src before this effect ran
    // (its init effect commits first) — attempt now AND on every loadstart.
    attempt();
    el.addEventListener("loadstart", attempt);
    return () => {
      cancelled = true;
      el.removeEventListener("loadstart", attempt);
    };
  }, [playback, current.id, autoplayWanted]);

  // Prefetch the next episode's playback token once the playhead is within
  // PRELOAD_LEAD_SECONDS of the end, so auto-advance skips the token
  // round-trip (the hidden preloader element below warms the stream
  // itself). Trial mode is excluded: its token TTL is the preview's
  // remaining seconds — a prefetched trial token is dead by the time it's
  // needed, and a 60s preview ends at the paywall, not the next episode.
  // Prefetch failures are deliberately silent: the advance path falls back
  // to a fetch-on-swap, which still reuses the live element.
  useEffect(() => {
    if (!playback || playback.episodeId !== current.id) return;
    if (mode === "trial") return;
    if (!next || isEpisodeLocked(next.tier, mode)) return;
    const el = videoRef.current;
    if (!el) return;
    const nextId = next.id;
    let cancelled = false;
    const check = () => {
      if (prefetchAttemptedRef.current) return;
      // Right after an auto-advance the element still holds the FINISHED
      // episode (ended, remaining 0) until the new src installs — without
      // this guard the boundary check() would prefetch the next-NEXT
      // episode immediately instead of PRELOAD_LEAD_SECONDS before the end.
      if (el.ended) return;
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (dur - el.currentTime > PRELOAD_LEAD_SECONDS) return;
      prefetchAttemptedRef.current = true;
      fetch(`/api/playback-token?episode_id=${encodeURIComponent(nextId)}`, {
        cache: "no-store",
      })
        .then(async (r) => {
          if (!r.ok || cancelled) return;
          const data = (await r.json()) as {
            token: unknown;
            expiresIn: unknown;
            mode?: unknown;
          };
          if (
            typeof data.token !== "string" ||
            typeof data.expiresIn !== "number" ||
            cancelled
          ) {
            return;
          }
          setNextPrefetch({
            episodeId: nextId,
            token: data.token,
            expiresAt: Date.now() + data.expiresIn * 1000,
            mode:
              data.mode === "free" || data.mode === "member"
                ? data.mode
                : null,
          });
        })
        .catch(() => {});
    };
    check();
    el.addEventListener("timeupdate", check);
    return () => {
      cancelled = true;
      el.removeEventListener("timeupdate", check);
    };
  }, [playback, current.id, mode, next]);

  // Autoplay-block detection. A failed first-play attempt leaves the
  // element paused with no event (e.g. the capability probe passed but the
  // real play still got denied, or playback-core raced us). If the media
  // has metadata and nothing has played ~2s later, surface a tap-to-play
  // affordance — unless the pause was the user's own. Armed on
  // loadedmetadata as well as canplay: iOS Safari's native-HLS path often
  // never reaches canplay for a paused element (it stops at
  // HAVE_METADATA), which would otherwise make the overlay unreachable on
  // exactly the platform (Low Power Mode) it exists for. The tap is a real
  // gesture, so it also blesses the element for unmuted auto-advance later
  // (WebKit's blessing is per-element and survives src changes).
  useEffect(() => {
    if (!playback || playback.episodeId !== current.id) return;
    if (!autoplayWanted) return;
    const el = videoRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (firstFrameFiredRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (
          !firstFrameFiredRef.current &&
          el.paused &&
          !el.ended &&
          !pausedByUserRef.current
        ) {
          setNeedsTap(true);
        }
      }, 2_000);
    };
    if (el.readyState >= 1) arm();
    el.addEventListener("loadedmetadata", arm);
    el.addEventListener("canplay", arm);
    return () => {
      el.removeEventListener("loadedmetadata", arm);
      el.removeEventListener("canplay", arm);
      if (timer) clearTimeout(timer);
    };
  }, [playback, current.id, autoplayWanted]);

  // Auto-hide the "Up next" chip a few seconds after an auto-advance.
  useEffect(() => {
    if (!chipEpisodeId) return;
    const timer = setTimeout(() => setChipEpisodeId(null), 5_000);
    return () => clearTimeout(timer);
  }, [chipEpisodeId]);

  // Emit playback_failed once when we surrender to the infra-error overlay
  // (5xx / decode / network / parse) — distinct from the expected paywall and
  // rate-limit end-states. Lets us measure real player-failure rate vs ordinary
  // bounce. No-op without marketing consent (PostHog not loaded).
  useEffect(() => {
    if (endState === "unavailable") {
      capturePostHog("playback_failed", { show_slug: showSlug, mode });
    }
  }, [endState, showSlug, mode]);

  // The portrait chrome has no lock affordance. If a viewer locked the standard
  // chrome and then crossed into the mobile vertical layout (a wide→narrow
  // resize / tablet rotate), clear the inherited lock so they aren't left in a
  // half-locked state the vertical UI can't unlock.
  useEffect(() => {
    if (verticalLayout && locked) onLockChange(false);
  }, [verticalLayout, locked, onLockChange]);

  // Wall renders. Lock-based (currentLocked) covers deep links, overlay
  // taps, and auto-advance; endState covers server 403s and natural
  // end-of-tier transitions. Both resolve to the same two surfaces.
  const signupWallTarget = currentLocked
    ? current
    : (firstMemberEpisode ?? current);
  if (
    endState === "signupWall" ||
    (currentLocked && mode === "free" && current.tier === "member")
  ) {
    return (
      <SignupWall
        showSlug={showSlug}
        showId={showId}
        showTitle={showTitle}
        episodeLabel={`S${signupWallTarget.seasonNumber}·E${signupWallTarget.number}`}
        targetEpisodeId={signupWallTarget.id}
        episodeNumber={
          episodes.findIndex((e) => e.id === signupWallTarget.id) + 1
        }
        memberCount={memberCount}
      />
    );
  }

  if (endState === "paywall" || currentLocked) {
    return (
      <Paywall
        showSlug={showSlug}
        episodeId={current.id}
        resumeSeconds={lastSaved || undefined}
        showTitle={showTitle}
        episodeLabel={episodeLabel}
        variant={mode === "free" || mode === "member" ? "tier" : "trial"}
        payFirst={payFirst}
      />
    );
  }

  if (endState === "rateLimited") {
    return <RateLimitedNotice showSlug={showSlug} />;
  }

  if (endState === "unavailable") {
    return <PlaybackUnavailable showSlug={showSlug} onRetry={retry} />;
  }

  // Sizing for the pre-playback surfaces (loading splash, poster gate). The
  // mobile vertical layout fills the canvas; a vertical show on desktop (or
  // the brief moment before the mobile probe settles) gets a portrait box so
  // it matches the player it's about to become; everything else is 16:9.
  const surfaceShape = verticalLayout
    ? "h-full"
    : orientation === "vertical"
      ? "mx-auto aspect-[9/16] max-w-[min(100vw,calc(100vh*9/16))]"
      : "aspect-video";

  const loadingSurface = (
    <div
      className={`relative flex w-full items-center justify-center overflow-hidden bg-black ${surfaceShape}`}
    >
      {current.thumbnailUrl ? (
        <Image
          src={current.thumbnailUrl}
          alt=""
          fill
          sizes="100vw"
          className="object-cover opacity-40"
          priority
        />
      ) : null}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/55"
      />
      <div className="relative z-10 flex items-center gap-3 text-white/60">
        <span className="size-2 animate-pulse rounded-full bg-[#ff3d3d]" />
        <span className="text-xs font-medium uppercase tracking-[0.3em]">
          {t.watch.loading}
        </span>
      </div>
    </div>
  );

  // While the autoplay-capability probe settles (trial/free humans —
  // typically tens of milliseconds), show the splash rather than flashing
  // the poster gate at users who are about to autoplay.
  if (!started && autoplayProbe === "pending") {
    return loadingSurface;
  }

  // Poster play-gate — crawler sessions (autoplay=false from the server's
  // isBot check, so bots never trigger the row-minting token fetch),
  // autoplay-blocked sessions (the probe said no — minting on land would
  // burn the 60s clock with zero frames), and pre-gesture rate-limited
  // lands. The tap is the user gesture that starts the session.
  if (!started) {
    return (
      <div
        className={`relative flex w-full items-center justify-center overflow-hidden bg-black ${surfaceShape}`}
      >
        {current.thumbnailUrl ? (
          <Image
            src={current.thumbnailUrl}
            alt=""
            fill
            sizes="100vw"
            className="object-cover opacity-40"
            priority
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/55"
        />
        <button
          type="button"
          onClick={() => {
            capturePostHog("play_attempted", {
              show_slug: showSlug,
              show_title: showTitle ?? showSlug,
            });
            hadGestureRef.current = true;
            setStarted(true);
          }}
          aria-label={t.player.playPauseAria}
          className="group absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-white"
        >
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/20 bg-white/15 backdrop-blur-xl transition-transform duration-150 group-hover:scale-105">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={32} />
            </span>
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/80">
            {mode === "free" ? t.player.playFreeEpisode : t.player.playPreview}
          </span>
        </button>
        <Link
          href={`/shows/${showSlug}`}
          aria-label={t.player.backToShowAria}
          className="absolute left-5 top-5 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/70 sm:left-8"
        >
          <Icon name="back" size={18} />
        </Link>
      </div>
    );
  }

  // First-load splash, shown while the very first token fetch is in flight
  // (autoplay sessions land here instead of the poster gate, so keep the
  // episode thumbnail as the backdrop — a black void on land reads as
  // broken). Auto-advance never returns here: the snapshot stays mounted
  // through the transition so the <video> element survives.
  if (!playback) {
    return loadingSurface;
  }

  // media-chrome theme variables — shared by both chromes. Split out from the
  // container sizing so the portrait/TikTok layout can fill the viewport while
  // the standard layout still letterboxes to the asset's aspect ratio.
  const mediaVars = {
    "--media-primary-color": "#ffffff",
    "--media-secondary-color": "transparent",
    "--media-text-color": "#ffffff",
    "--media-control-background": "transparent",
    "--media-control-hover-background": "rgba(255,255,255,0.08)",
    "--media-range-bar-color": "#ff3d3d",
    "--media-range-track-background": "rgba(255,255,255,0.18)",
    "--media-range-track-border-radius": "2px",
    "--media-range-track-height": "4px",
    "--media-range-thumb-background": "#ff3d3d",
    "--media-range-thumb-border-radius": "9999px",
    "--media-range-thumb-width": "12px",
    "--media-range-thumb-height": "12px",
    "--media-range-thumb-box-shadow": "0 0 0 6px rgba(255,61,61,0.25)",
    "--media-tooltip-display": "none",
    // Letterbox the slotted <video> inside the controller (media-chrome's
    // default, pinned explicitly): a no-op for the standard layout (its box
    // matches the asset ratio) and what makes the full-bleed vertical layout
    // centre a 9:16 asset with black bars instead of cropping or stretching.
    "--media-object-fit": "contain",
    "--media-font-family":
      "var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif",
    // Settings / rendition menu — cinema-red themed.
    "--media-menu-background": "rgba(15, 15, 18, 0.95)",
    "--media-menu-border": "1px solid rgba(255, 255, 255, 0.1)",
    "--media-menu-border-radius": "10px",
    "--media-menu-padding": "6px",
    "--media-menu-item-border-radius": "6px",
    "--media-menu-item-checked-bg": "rgba(255, 61, 61, 0.15)",
    "--media-menu-item-checked-color": "#ff3d3d",
    "--media-menu-item-hover-background": "rgba(255, 255, 255, 0.08)",
    "--media-menu-icon-color": "#ffffff",
  } as React.CSSProperties;

  // Vertical (mobile) fills the WatchShell's fixed full-screen black canvas;
  // the <video> below letterboxes the portrait asset inside it via
  // object-contain. Otherwise keep the asset-shaped, viewport-letterboxed box.
  const containerStyle: React.CSSProperties = verticalLayout
    ? {
        display: "block",
        width: "100%",
        height: "100%",
        backgroundColor: "#000",
        ...mediaVars,
      }
    : {
        display: "block",
        width: "100%",
        aspectRatio: supportsAspectRatio ? aspectRatio : undefined,
        ...(!supportsAspectRatio
          ? {
              position: "relative" as const,
              height: 0,
              paddingBottom: `${(1 / aspectRatio) * 100}%`,
            }
          : {}),
        // Letterbox to fit the viewport whichever way the video is shaped:
        // vertical assets cap at `100vh * ratio` (narrow on landscape,
        // ~viewport-wide on portrait); horizontal assets cap by width.
        maxWidth: `min(100vw, calc(100vh * ${aspectRatio}))`,
        margin: "0 auto",
        backgroundColor: "#000",
        ...mediaVars,
      };

  return (
    <MediaController
      style={containerStyle}
      className="group/player relative isolate"
    >
      <MuxVideo
        // Keyed on the refresh nonce so a subscriber token refresh remounts
        // the element (the wrapper ignores tokens-only changes);
        // playhead/play-state are restored in onLoadedMetadata. Episode
        // auto-advance does NOT bump the nonce: it changes playbackId+token
        // together, which the wrapper applies in place on the same <video> —
        // preserving the element's autoplay blessing across episodes.
        key={refreshNonce}
        ref={videoRef}
        slot="media"
        playbackId={playback.playbackId}
        tokens={{ playback: playback.token }}
        streamType="on-demand"
        // Without playsInline iOS Safari auto-promotes the video into its
        // system player on tap, drawing native chrome over ours. Setting
        // it keeps playback in the page so our custom controls own the
        // surface; the fullscreen button still hands off to the system
        // player on demand.
        playsInline
        // No autoPlay prop on purpose: the first-play attempt (unmuted →
        // muted fallback on NotAllowedError only) is owned by our effect
        // above, so a user's startup pause sticks instead of being
        // force-resumed by playback-core's "any" chain.
        envKey={muxDataEnabled ? MUX_DATA_ENV_KEY : undefined}
        disableTracking={!muxDataEnabled}
        disableCookies={!muxDataEnabled}
        metadata={{
          video_id: current.id,
          video_title: current.title,
          // video_series gives the per-show breakdown in the Mux dashboard.
          video_series: showTitle ?? showSlug,
          player_name: "matio-watch",
        }}
        onLoadedMetadata={(e) => {
          // HTMLVideoElement exposes intrinsic dimensions once the
          // manifest is parsed. Use those to size the player container
          // so portrait/landscape both render naturally.
          const v = e.currentTarget;
          if (v.videoWidth > 0 && v.videoHeight > 0) {
            setAspectRatio(v.videoWidth / v.videoHeight);
          }
          // Restore playhead/play-state after a token-refresh remount (mirrors
          // Mux's own in-place re-init). resumeSeconds (server resume) is
          // handled by a separate effect and only on the initial episode load,
          // so the two never collide.
          const resumeAt = resumeAfterRefreshRef.current;
          if (resumeAt != null) {
            resumeAfterRefreshRef.current = null;
            if (mutedAtRefreshRef.current != null) {
              v.muted = mutedAtRefreshRef.current;
              mutedAtRefreshRef.current = null;
            }
            if (resumeAt > (v.currentTime ?? 0)) v.currentTime = resumeAt;
            if (wasPlayingRef.current) {
              // The remounted element has no gesture blessing — if the
              // unmuted restore is denied, continue muted rather than
              // silently stalling at minute ~59.
              void v.play().catch((err: unknown) => {
                if ((err as { name?: string })?.name !== "NotAllowedError") {
                  return;
                }
                v.muted = true;
                void v.play().catch(() => {});
              });
            }
          }
        }}
        onPause={() => {
          // `pause` only fires for real pause() calls and the natural-end
          // transition (reset in onEnded) — never for a blocked autoplay
          // attempt or the wrapper's teardown (load() emits no pause). So
          // this reliably marks "the user chose to stop".
          pausedByUserRef.current = true;
        }}
        onPlaying={() => {
          setNeedsTap(false);
          pausedByUserRef.current = false;
          // Funnel events = "started watching": fire from the first real
          // frame, NOT token issuance, so blocked-autoplay lands don't
          // count. Both deduped to once per session by the shell. Meta
          // ViewContent fires for every mode; PostHog trial_play_started
          // keeps its preview-only meaning.
          onFirstPlay();
          if (mode === "trial") onTrialStart();
          // First playback frame for this episode (the guard ref survives
          // token-refresh remounts and resets on auto-advance). If it's
          // playing muted because OUR fallback muted it, offer the unmute
          // pill — user-muted starts (pref/manual) don't qualify. No-op
          // without marketing consent (PostHog not loaded).
          if (firstFrameFiredRef.current) return;
          firstFrameFiredRef.current = true;
          if (videoRef.current?.muted && mutedByFallbackRef.current) {
            setShowUnmutePill(true);
          }
          capturePostHog("first_frame", { show_slug: showSlug, mode });
        }}
        onVolumeChange={() => {
          // User unmuted through the regular mute button (or we did via the
          // pill) — the pill is moot either way.
          if (videoRef.current && !videoRef.current.muted) {
            setShowUnmutePill(false);
          }
        }}
        onError={(e) => {
          // HTMLMediaElement exposes MediaError on the element after an
          // error fires. Codes:
          //   1 MEDIA_ERR_ABORTED              — user-driven, ignore.
          //   2 MEDIA_ERR_NETWORK              — transient, let HLS retry.
          //   3 MEDIA_ERR_DECODE               — terminal.
          //   4 MEDIA_ERR_SRC_NOT_SUPPORTED    — terminal.
          // Transient errors (no code, NETWORK, or unknown) trip the
          // unavailable end-state only after 3 occurrences in 10s — a
          // single buffer-stall on cellular shouldn't kill the player.
          const code = e.currentTarget.error?.code;
          if (code === 3 || code === 4) {
            setEndState("unavailable");
            return;
          }
          if (code === 1) return;
          const now = Date.now();
          errorTimesRef.current = [
            ...errorTimesRef.current.filter((ts) => now - ts < 10_000),
            now,
          ];
          if (errorTimesRef.current.length >= 3) {
            setEndState("unavailable");
          }
        }}
        onEnded={() => {
          const el = videoRef.current;
          if (el) {
            const t = Math.floor(el.duration ?? 0);
            if (mode === "trial" || mode === "free") {
              void saveTrialPosition(current.id, t).catch(() => {});
            } else {
              void saveWatchProgress(current.id, t, true).catch(() => {});
            }
          }
          if (next) {
            if (isEpisodeLocked(next.tier, mode)) {
              // Auto-advance into the locked episode: the swap remounts the
              // inner player which renders the right wall full-surface, and
              // ?ep=<locked id> lands in the URL so the post-signup redirect
              // resumes exactly there. No up-next countdown into a wall.
              onSwap(next.id);
            } else if (mode === "trial") {
              // Legacy 60s preview: keep the countdown card. The preview
              // ends at the paywall, not the next episode — instant
              // advance would burn the remaining seconds on a transition
              // the user didn't choose.
              onOverlayChange("upnext");
            } else {
              // Instant auto-advance: same <video> element, new src.
              // Install the prefetched token here (falling back to the
              // fetch effect when it's missing or about to expire) — the
              // first-play effect then starts the new episode on the
              // still-blessed element. This handler is the only entry into
              // the gapless path, so all per-episode refs reset here too
              // (the render-phase block handles the visual state).
              capturePostHog("episode_auto_advanced", {
                show_slug: showSlug,
                from_episode: currentPosition,
                to_episode: currentPosition + 1,
              });
              lastSavedRef.current = 0;
              firstFrameFiredRef.current = false;
              tierStartFiredRef.current = false;
              prefetchAttemptedRef.current = false;
              errorTimesRef.current = [];
              resumeAfterRefreshRef.current = null;
              wasPlayingRef.current = false;
              pausedByUserRef.current = false;
              if (
                nextPrefetch &&
                nextPrefetch.episodeId === next.id &&
                nextPrefetch.expiresAt > Date.now() + 5_000
              ) {
                setPlayback({
                  episodeId: next.id,
                  playbackId: next.playbackId,
                  token: nextPrefetch.token,
                  expiresAt: nextPrefetch.expiresAt,
                });
                // The fetch effect — the usual emitter of the tier-start
                // funnel events — is skipped on this path, so fire from
                // the prefetched response's mode instead.
                if (
                  nextPrefetch.mode === "free" ||
                  nextPrefetch.mode === "member"
                ) {
                  tierStartFiredRef.current = true;
                  capturePostHog(
                    nextPrefetch.mode === "free"
                      ? "free_episode_started"
                      : "member_episode_started",
                    {
                      show_slug: showSlug,
                      episode_number: currentPosition + 1,
                    },
                  );
                }
              }
              // No usable prefetch: keep the old snapshot mounted (paused
              // on its end frame) so the element survives; the token-fetch
              // effect sees playback.episodeId !== current.id and swaps in
              // place (firing the tier events itself).
              setNextPrefetch(null);
              setChipEpisodeId(next.id);
              onAdvance(next.id);
            }
          } else if (mode === "subscriber") {
            // Last episode of the show finished. Subscribers see the
            // "next episode in production" reminder sheet. Trial users
            // realistically can't reach this branch (60s preview vs
            // full episode duration); skip the overlay for them so a
            // freak edge case — say a 30s teaser — doesn't dump a paid
            // surface on a free preview.
            onOverlayChange("seriesEnd");
          } else if (mode === "member") {
            // End of the member tier and nothing beyond is published yet —
            // this IS the subscription paywall moment for members.
            setEndState("paywall");
          } else if (mode === "free") {
            // free_episodes covers every ready episode (member tier empty
            // until more publish) — still pitch the account.
            setEndState("signupWall");
          }
        }}
        className="h-full w-full"
      />

      {/* Portrait / TikTok chrome (vertical shows on mobile). Shares this
          MediaController + <MuxVideo> element with the standard chrome — only
          the control layout differs. */}
      {verticalLayout ? (
        <VerticalChrome
          showSlug={showSlug}
          showTitle={showTitle}
          episodeTitle={current.title}
          episodeLabel={episodeLabel}
          episodesCount={episodes.length}
          hasNext={!!next}
          showSkipIntro={showSkipIntro}
          showUnmutePill={showUnmutePill}
          needsTap={needsTap}
          chipVisible={chipEpisodeId === current.id}
          onOpenEpisodes={() => onOverlayChange("episodes")}
          onUnmute={() => {
            const el = videoRef.current;
            if (el) el.muted = false;
            setShowUnmutePill(false);
          }}
          onTapPlay={() => {
            hadGestureRef.current = true;
            setNeedsTap(false);
            const el = videoRef.current;
            if (el) void el.play().catch(() => {});
          }}
          onSkipIntro={() => {
            const el = videoRef.current;
            if (el && current.introEndSeconds != null) {
              el.currentTime = current.introEndSeconds;
            }
          }}
        />
      ) : null}

      {!verticalLayout && (
        <>
      {/* Top scrim */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-5 pb-14 pt-5 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:px-8 ${locked ? "!opacity-0 !pointer-events-none" : ""}`}
      >
        <div className="pointer-events-auto flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/shows/${showSlug}`}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
              aria-label={t.player.backToShowAria}
            >
              <Icon name="back" size={18} />
            </Link>
            <div className="min-w-0">
              <p className="font-mono text-[11px] leading-none text-white/70">
                {episodeLabel}
              </p>
              <h1 className="mt-0.5 truncate text-base font-bold leading-tight text-white sm:text-lg">
                {showTitle ? `${showTitle} — ${current.title}` : current.title}
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-5 text-white/85 sm:flex">
            {/* AirPlay button auto-hides when no AirPlay targets are
                available (Safari with a discoverable device only).
                pointer-coarse pads the hit-area on touch without
                inflating desktop visual size. */}
            <MediaAirplayButton
              className="!bg-transparent !p-0 pointer-coarse:!p-2 text-current transition-colors hover:text-white"
              aria-label={t.player.castAria}
            >
              <span slot="icon" className="contents">
                <Icon name="cast" size={20} />
              </span>
            </MediaAirplayButton>
            {/* Captions button — gated on a real text track being present
                on the underlying media element. media-chrome's own
                auto-hide misfires when Mux exposes empty/CEA-608
                placeholder tracks, so we control visibility ourselves. */}
            {hasCaptions ? (
              <MediaCaptionsButton
                className="!bg-transparent !p-0 pointer-coarse:!p-2 text-current transition-colors hover:text-white"
                aria-label={t.player.captionsAria}
              >
                <span slot="icon" className="contents">
                  <Icon name="subtitle" size={20} />
                </span>
              </MediaCaptionsButton>
            ) : null}
          </div>
        </div>
      </div>

      {/* Center cluster */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 ${locked ? "!opacity-0 !pointer-events-none" : ""}`}
      >
        <div className="pointer-events-auto flex items-center gap-10 text-white">
          <MediaSeekBackwardButton
            seekOffset={10}
            className="!flex flex-col items-center gap-1 !bg-transparent !p-0 text-white/85 transition-colors hover:text-white"
            aria-label={t.player.back10Aria}
          >
            <span slot="icon" className="contents">
              <Icon name="rewind" size={26} />
            </span>
            <span className="font-mono text-[9px] opacity-70">10s</span>
          </MediaSeekBackwardButton>
          <MediaPlayButton
            className="!flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/20 !bg-white/15 text-white backdrop-blur-xl transition-transform hover:scale-105"
            aria-label={t.player.playPauseAria}
          >
            <span slot="play" className="contents">
              <span className="-mr-1 inline-flex">
                <Icon name="play" size={32} />
              </span>
            </span>
            <span slot="pause" className="contents">
              <Icon name="pause" size={32} />
            </span>
          </MediaPlayButton>
          <MediaSeekForwardButton
            seekOffset={10}
            className="!flex flex-col items-center gap-1 !bg-transparent !p-0 text-white/85 transition-colors hover:text-white"
            aria-label={t.player.forward10Aria}
          >
            <span slot="icon" className="contents">
              <Icon name="forward" size={26} />
            </span>
            <span className="font-mono text-[9px] opacity-70">10s</span>
          </MediaSeekForwardButton>
        </div>
      </div>

      {/* Skip-intro chip — only renders when in the intro window and the
          chrome isn't locked. */}
      {showSkipIntro && !locked && current.introEndSeconds != null ? (
        <button
          type="button"
          onClick={() => {
            const el = videoRef.current;
            if (el && current.introEndSeconds != null) {
              el.currentTime = current.introEndSeconds;
            }
          }}
          className="absolute bottom-[110px] right-5 z-20 rounded-md border border-white/25 bg-white/15 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-xl transition-colors hover:bg-white/25 sm:right-8"
        >
          {t.player.skipIntro}
        </button>
      ) : null}

      {/* "Tap for sound" pill — autoplay landed in the muted fallback. */}
      {showUnmutePill && !locked ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            // Route through media-chrome's request pipeline so its
            // persisted mute preference updates too — a bare el.muted
            // flip would be re-muted by the stored pref on the next
            // element mount.
            e.currentTarget.dispatchEvent(
              new CustomEvent("mediaunmuterequest", {
                composed: true,
                bubbles: true,
              }),
            );
            const el = videoRef.current;
            if (el) el.muted = false;
            setShowUnmutePill(false);
          }}
          className="absolute bottom-[110px] left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/25 bg-black/60 px-4 py-2 text-xs font-semibold text-white backdrop-blur-xl transition-colors hover:bg-black/75"
        >
          <Icon name="mute" size={14} />
          {t.player.tapForSound}
        </button>
      ) : null}

      {/* Tap-to-play — autoplay fully blocked (e.g. iOS Low Power Mode);
          playback-core leaves the element paused with no signal, so this
          is our own affordance. The tap doubles as the gesture that
          blesses the element for unmuted auto-advance later. */}
      {needsTap && !locked ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            hadGestureRef.current = true;
            setNeedsTap(false);
            const el = videoRef.current;
            if (el) void el.play().catch(() => {});
          }}
          aria-label={t.player.playPauseAria}
          className="absolute inset-0 z-20 flex items-center justify-center"
        >
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/20 bg-white/15 text-white backdrop-blur-xl">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={32} />
            </span>
          </span>
        </button>
      ) : null}

      {/* Transient "Up next" chip right after an auto-advance, so the
          instant cut doesn't disorient. */}
      {chipEpisodeId === current.id && !locked ? (
        <div className="pointer-events-none absolute left-1/2 top-5 z-20 max-w-[80%] -translate-x-1/2 truncate rounded-full border border-white/15 bg-black/60 px-4 py-2 text-xs font-semibold text-white backdrop-blur-xl">
          {t.player.upNextBtn} · {episodeLabel} — {current.title}
        </div>
      ) : null}
        </>
      )}

      {/* Brief dimmer while an un-prefetched auto-advance fetches its
          token — the old episode's end frame stays mounted underneath so
          the <video> element (and its autoplay blessing) survives.
          Deliberately interactive (pointer-events on, click swallowed):
          the controls below still belong to the FINISHED episode, and a
          seek/replay there would cross-write progress under the new id. */}
      {playback.episodeId !== current.id ? (
        <div
          aria-hidden
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-0 z-20 flex cursor-wait items-center justify-center bg-black/40"
        >
          <span className="size-2 animate-pulse rounded-full bg-[#ff3d3d]" />
        </div>
      ) : null}

      {!verticalLayout && (
        <>
      {/* Mini Matio branding */}
      <div
        className={`pointer-events-none absolute bottom-[88px] left-5 z-10 opacity-50 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:left-8 ${locked ? "!opacity-0" : ""}`}
      >
        <MatioLogo size={11} accent="#ff3d3d" color="#ffffff" />
      </div>

      {/* Bottom bar. Side/bottom padding honors iOS landscape notch +
          home-indicator safe-area; floors keep the original 1.25rem/2rem
          cushion on devices with no inset. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent pt-4 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pl-[max(env(safe-area-inset-left),2rem)] sm:pr-[max(env(safe-area-inset-right),2rem)] ${locked ? "!opacity-0 !pointer-events-none" : ""}`}
      >
        <MediaTimeRange className="!block !h-3 !w-full !bg-transparent" />
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-white/85">
          <MediaTimeDisplay className="!bg-transparent !p-0 !text-white/85" />
          <MediaTimeDisplay
            remaining
            className="!bg-transparent !p-0 !text-white/55"
          />
        </div>
        {/* Bottom controls. Right cluster wraps on narrow viewports so 5
            elements + 2 left controls don't overflow at 320–375px (made
            worse by Spanish localizations of Episodes/Up Next). Icon
            buttons grow padding on touch devices (pointer-coarse:) so
            they meet a ~44pt comfort target without inflating desktop. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2 text-white/85">
          <div className="flex items-center gap-5">
            <MediaMuteButton
              className="!bg-transparent !p-0 pointer-coarse:!p-2 text-current transition-colors hover:text-white"
              aria-label={t.player.muteAria}
            >
              <span slot="high" className="contents">
                <Icon name="volume" size={20} />
              </span>
              <span slot="medium" className="contents">
                <Icon name="volume" size={20} />
              </span>
              <span slot="low" className="contents">
                <Icon name="volume" size={20} />
              </span>
              <span slot="off" className="contents">
                <Icon name="mute" size={20} />
              </span>
            </MediaMuteButton>
            <button
              type="button"
              aria-label={t.player.lockAria}
              onClick={() => onLockChange(true)}
              className="-m-2 p-2 text-current transition-colors hover:text-white"
            >
              <Icon name="lock" size={18} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <MediaPlaybackRateButton
              rates={[0.5, 1, 1.25, 1.5, 2]}
              className="!rounded !bg-white/10 !px-2 !py-1 font-mono !text-[11px] !text-white transition-colors hover:!bg-white/15"
              aria-label={t.player.rateAria}
            />
            <button
              type="button"
              onClick={() => onOverlayChange("episodes")}
              className="rounded bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15"
            >
              {t.player.episodesBtn}
            </button>
            {next ? (
              <button
                type="button"
                onClick={() => onSwap(next.id)}
                className="hidden rounded bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15 sm:inline-flex"
              >
                {t.player.upNextBtn}
              </button>
            ) : null}
            {/* Quality picker — placed in the bottom bar so its menu has
                room to anchor upward (anchoring from the top bar got it
                clipped against the player edge). Auto-populates from the
                stream's renditions; auto-hides when there's only one. */}
            <MediaRenditionMenuButton
              className="!ml-1 !bg-transparent !p-0 pointer-coarse:!p-2 text-current transition-colors hover:text-white"
              aria-label={t.player.qualityAria}
            >
              <span slot="icon" className="contents">
                <Icon name="settings" size={18} />
              </span>
            </MediaRenditionMenuButton>
            <MediaFullscreenButton
              className="!bg-transparent !p-0 pointer-coarse:!p-2 text-current transition-colors hover:text-white"
              aria-label={t.player.fullscreenAria}
            >
              <span slot="enter" className="contents">
                <Icon name="fullscreen" size={20} />
              </span>
              <span slot="exit" className="contents">
                <Icon name="fullscreen" size={20} />
              </span>
            </MediaFullscreenButton>
          </div>
        </div>
      </div>

      {/* Rendition (quality) menu — pinned to the bottom-right of the
          player, sitting above the bottom bar. We bypass media-chrome's
          auto-anchor positioning (which was clipping the menu against
          the player edge) by positioning it explicitly. The button still
          toggles it via media-chrome's internal invoker wiring. */}
      <MediaRenditionMenu
        hidden
        anchor="auto"
        className="!absolute !right-5 !bottom-[92px] z-30 !font-sans sm:!right-8"
        style={{ minWidth: "180px" }}
      />

      {/* Unlock pill — only thing interactive when chrome is locked. */}
      {locked ? (
        <button
          type="button"
          onClick={() => onLockChange(false)}
          className="absolute left-1/2 top-1/2 z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:bg-black/75"
          aria-label={t.player.unlockAria}
        >
          <Icon name="lock" size={16} />
          {t.player.tapToUnlock}
        </button>
      ) : null}
        </>
      )}

      {/* Hidden next-episode preloader: starts ~PRELOAD_LEAD_SECONDS before
          the end and buffers ~30s of the upcoming episode, landing its
          segments in the browser HTTP cache for the visible player's
          re-init (Mux segment URLs are deterministic and cacheable for a
          week; playlists are no-store but tiny). display:none — never
          slotted as media; Mux Data force-disabled so it can't count
          phantom views or drop viewer cookies. */}
      {nextPrefetch && next && nextPrefetch.episodeId === next.id ? (
        <MuxVideo
          key={nextPrefetch.episodeId}
          style={{ display: "none" }}
          aria-hidden
          muted
          playsInline
          preload="auto"
          playbackId={next.playbackId}
          tokens={{ playback: nextPrefetch.token }}
          streamType="on-demand"
          disableTracking
          disableCookies
        />
      ) : null}

      {/* Overlays */}
      {overlay === "episodes" ? (
        <EpisodesOverlay
          episodes={episodes}
          currentEpisodeId={current.id}
          showSlug={showSlug}
          mode={mode}
          onSelect={onSwap}
          onClose={() => onOverlayChange("none")}
        />
      ) : null}
      {overlay === "upnext" && next ? (
        <UpNextOverlay
          next={next}
          showSlug={showSlug}
          onPlayNow={() => onSwap(next.id)}
          onCancel={() => onOverlayChange("none")}
        />
      ) : null}
      {overlay === "seriesEnd" ? (
        <SeriesEndOverlay
          showId={showId}
          showTitle={showTitle ?? current.title}
          defaultEmail={userEmail}
          onDismiss={() => onOverlayChange("none")}
        />
      ) : null}
    </MediaController>
  );
}
