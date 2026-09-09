"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import MuxVideo from "@mux/mux-video-react";
import { canAutoplayMuted } from "@/lib/can-autoplay";
import { useMarketingConsent } from "@/lib/use-marketing-consent";
import { useVerticalLayout } from "@/lib/use-vertical-layout";
import {
  FORK_WINDOW_MAX_SECONDS,
  displayNumber,
  listedAncestor,
  listedEpisodes,
  listedPosition,
  resolveCandidates,
  type Candidates,
  type PlayerChoice,
} from "@/lib/branching";
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
import {
  saveTrialPosition,
  saveWatchProgress,
  saveWatchSegments,
} from "@/app/watch/actions";
import { WATCH_SEGMENT_BUCKET_SECONDS } from "@/lib/watch-segments";

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
const ForkChoiceOverlay = dynamic(
  () => import("./fork-choice-overlay").then((m) => m.ForkChoiceOverlay),
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
  // Branching video (#144). A branch (branchOfEpisodeId set) is PLAYABLE
  // but unlisted: it stays in the Player's `episodes` array so a choice or
  // a ?ep= deep link can land on it, while every list the player renders
  // goes through listedEpisodes(). `forkPrompt` and the choice labels are
  // already in the site locale (the watch page picks es/en); `choices` is
  // null on a plain linear episode. What an edge set MEANS is decided by
  // lib/branching.ts:resolveCandidates.
  branchOfEpisodeId: string | null;
  forkPrompt: string | null;
  forkWindowSeconds: number;
  choices: PlayerChoice[] | null;
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

// Branching (#144): the subscriber token-refresh remount is held while the
// fork prompt is open or the episode is this close to its end — the gapless
// transition installs a fresh token moments later anyway. The hold is
// BOUNDED: it lifts on its own after the longest possible window plus a
// margin (the flag is only ever rewritten by `timeupdate`, so a paused
// element would otherwise keep it up until the token expired), and it never
// applies to a paused element at all — a remount of a paused element is
// harmless (nothing is playing to interrupt, and the restore path does not
// call play() for a paused snapshot).
const REFRESH_HOLD_TAIL_SECONDS = 15;
const REFRESH_HOLD_MAX_MS = (FORK_WINDOW_MAX_SECONDS + 5) * 1000;

// A prefetched playback token for one transition candidate. `mode` carries
// the response's tier so the gapless install can fire the free/member
// episode-start funnel events (the fetch effect — their usual emitter — is
// skipped on that path).
type TokenPrefetch = {
  token: string;
  expiresAt: number;
  mode: "free" | "member" | null;
};

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
  freeMode = false,
  signupGate = false,
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
  // Payments kill-switch (server-read, !paymentsEnabled()): the series-end
  // paywall/signup-wall are mounted CLIENT-SIDE at `ended` with no server
  // 403 involved, so the flag must reach this component to route those
  // moments to the neutral series-end overlay instead.
  freeMode?: boolean;
  // Signup gate (server-read, signupRequired()): anonymous visitors see the
  // SignupWall before any playback. Only swaps the wall's copy to the
  // "watch for free" variant — the locking itself rides the member-tier
  // presentation the watch page applies.
  signupGate?: boolean;
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
  // Where the current episode leads (#144): a fork (prompt + default), a
  // single follower (the linear run, or a branch's silent reconvergence),
  // or the end. The full `episodes` array keeps the branches — the
  // `find(...) ?? episodes[0]` above over a filtered array would silently
  // restart the show from episode 1 the moment a branch id arrived by ?ep=.
  const candidates = useMemo(
    () => resolveCandidates(current, episodes),
    [current, episodes],
  );

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
      candidates={candidates}
      episodes={episodes}
      mode={mode}
      showId={showId}
      showSlug={showSlug}
      showTitle={showTitle}
      resumeSeconds={resumeForThisLoad}
      autoplay={autoplay}
      overlay={overlay}
      onOverlayChange={setOverlay}
      onSwap={swap}
      onAdvance={advance}
      onTrialStart={onTrialStart}
      onFirstPlay={onFirstPlay}
      userEmail={userEmail}
      payFirst={payFirst}
      freeMode={freeMode}
      signupGate={signupGate}
      orientation={orientation}
    />
  );
}

function EpisodePlayback({
  current,
  candidates,
  episodes,
  mode,
  showId,
  showSlug,
  showTitle,
  resumeSeconds,
  autoplay,
  overlay,
  onOverlayChange,
  onSwap,
  onAdvance,
  onTrialStart,
  onFirstPlay,
  userEmail,
  payFirst,
  freeMode,
  signupGate,
  orientation,
}: {
  current: PlayerEpisode;
  candidates: Candidates<PlayerEpisode>;
  episodes: PlayerEpisode[];
  mode: Mode;
  showId: string;
  showSlug: string;
  showTitle?: string;
  resumeSeconds: number | null;
  autoplay: boolean;
  overlay: OverlayKind;
  onOverlayChange: (overlay: OverlayKind) => void;
  onSwap: (episodeId: string) => void;
  onAdvance: (episodeId: string) => void;
  onTrialStart: () => void;
  onFirstPlay: () => void;
  userEmail?: string | null;
  payFirst?: boolean;
  freeMode?: boolean;
  signupGate?: boolean;
  orientation: ShowOrientation;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const t = useT();
  // Where this episode leads (#144), resolved by the shell. `next` is the
  // single follower or a fork's default — what the transport's next button
  // and the trial up-next card jump to, and what plays on a silent timeout.
  const fork = candidates.kind === "fork" ? candidates : null;
  const next: PlayerEpisode | null =
    candidates.kind === "next"
      ? candidates.episode
      : fork
        ? fork.defaultOption.episode
        : null;
  // Every episode the transition may land on — the token prefetch targets.
  const candidateEpisodes = useMemo(
    () => (fork ? fork.options.map((o) => o.episode) : next ? [next] : []),
    [fork, next],
  );
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
  // What a consent flip does to the LIVE element (issue #127). This is NOT
  // the hero's situation: <mux-player> is a custom element whose
  // attributeChangedCallback tears the stream down on `disable-tracking`
  // (#126), whereas @mux/mux-video-react renders a bare <video> and reads
  // envKey/disableTracking/disableCookies ONLY inside playback-core's
  // initialize(), from an effect keyed on the src alone (dist/index.mjs:
  // `useEffect(() => { … initialize(t, a, …) … }, [d])`, d = the Mux URL).
  // So flipping the props on <MuxVideo> mid-episode never unloads, reloads
  // or play()s anything — no orphan rejection is possible on this path —
  // but it also changes NOTHING on a monitor that is already running.
  //
  // A GRANT therefore takes effect at the next initialize (auto-advance src
  // swap, token-refresh remount, manual swap): the conservative direction —
  // nothing fires without consent, the viewer is merely unmeasured until the
  // next episode. A WITHDRAWAL must not wait for that: stop the running
  // monitor on the spot through mux-embed's own `video.mux.destroy()` — the
  // very call playback-core's teardown makes. It removes the element
  // listeners, flushes the final view-end beacon (the same one teardown
  // would send at the next episode, only earlier), and marks the handle
  // `deleted`, so that later teardown skips it. The stream is untouched, and
  // the next initialize sees disableTracking=true and stays off. The muxData
  // cookie is cleared by the banner (clearMarketingCookies).
  useEffect(() => {
    if (muxDataEnabled) return;
    const handle = videoRef.current?.mux;
    if (handle && !handle.deleted) handle.destroy();
  }, [muxDataEnabled]);
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
  // Prefetched tokens for every candidate of the transition (#144: a fork
  // has up to three, a linear run one), keyed by episode id and fetched
  // shortly before the current episode ends so the gapless path skips the
  // token round-trip.
  const [prefetches, setPrefetches] = useState<Record<string, TokenPrefetch>>(
    {},
  );
  // One prefetch attempt per candidate per episode; reset in the onEnded
  // advance path.
  const prefetchAttemptedRef = useRef<Set<string>>(new Set());
  // Fork prompt (#144): open while the playhead is inside the parent's
  // fork window (the timeupdate consumer below), the viewer's pick, and the
  // whole seconds left — the countdown the overlay shows IS the video
  // clock. The pick is read by the `ended` handler, which takes it (or the
  // default) down the same gapless path as auto-advance.
  const [forkOpen, setForkOpen] = useState(false);
  const [forkRemaining, setForkRemaining] = useState(0);
  const [forkChosenId, setForkChosenId] = useState<string | null>(null);
  // True while the prompt is open or the end is < REFRESH_HOLD_TAIL_SECONDS
  // away: the subscriber token-refresh remount must not land in the middle
  // of a choice (see the refresh effect).
  const refreshHoldRef = useRef(false);
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

  // Viewer-facing numbering (#144): everything shown by position reads the
  // LISTED run — a branch prints its parent's number ("Ep. 3" throughout a
  // fork on episode 3, never "Ep. 903"), and the position-keyed funnel
  // events keep the server's meaning (a branch is position 0, exactly like
  // getOrderedReadyEpisodeIds), so the Meta Lead check in onEnded can never
  // fire on a branch.
  const listed = useMemo(() => listedEpisodes(episodes), [episodes]);
  const anchor = listedAncestor(episodes, current) ?? current;
  const currentNumber = displayNumber(episodes, current);
  const episodeLabel = `S${current.seasonNumber}·E${currentNumber}`;

  // 1-based position of the current episode on the listed run (0 for a
  // branch) — matches the server's position semantics for funnel events.
  const currentPosition = listedPosition(episodes, current.id);
  // Whether the current episode is above this viewer's tier. All wall
  // triggers (deep link, episodes-overlay tap, auto-advance into a locked
  // episode) funnel through here: swapping to a locked episode remounts
  // this component, which renders the wall full-surface instead of
  // fetching a token.
  const currentLocked = isEpisodeLocked(current.tier, mode);
  // Previous episode on the listed run (null on the first). For a branch,
  // "previous" is the episode it forked from — replaying the parent is the
  // v1 way to choose again (no re-choose on a seek back; owner decision).
  // Swaps via the same manual-swap machinery as the episodes overlay /
  // up-next (onSwap remounts the inner player).
  const prev: PlayerEpisode | null =
    currentPosition > 1
      ? listed[currentPosition - 2]
      : (episodes.find((e) => e.id === current.branchOfEpisodeId) ?? null);
  const firstMemberEpisode = listed.find((e) => e.tier === "member") ?? null;
  const memberCount = listed.filter((e) => e.tier === "member").length;
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
    // Leftover prefetches here belong to a previous episode's candidates
    // (the advance path already consumed and cleared its own) — drop them.
    if (Object.keys(prefetches).length > 0) setPrefetches({});
    setForkOpen(false);
    setForkRemaining(0);
    setForkChosenId(null);
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
    // Branching (#144): the refresh REMOUNTS <MuxVideo> — never in the
    // middle of a choice, nor in the last seconds of a PLAYING episode,
    // where the gapless transition is about to install a fresh token
    // anyway. Polled here and again right before the remount (the prompt
    // may open during the fetch). Bounded by REFRESH_HOLD_MAX_MS from the
    // timer firing and lifted for a paused element — see the constant.
    const firedAt = () => Date.now();
    const waitWhileHeld = async (deadline: number) => {
      while (
        !cancelled &&
        refreshHoldRef.current &&
        videoRef.current?.paused === false &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    };
    const timer = setTimeout(async () => {
      const deadline = firedAt() + REFRESH_HOLD_MAX_MS;
      await waitWhileHeld(deadline);
      if (cancelled) return;
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
              // The prompt may have opened during the fetch — re-check the
              // hold before committing the remount (#144), same bound.
              await waitWhileHeld(deadline);
              if (cancelled) return;
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

  // Audience-retention segment tracking: mark each 10s bucket the playhead
  // traverses, flush the accumulated set every ~20s (and on hide/ended/
  // episode-change) to saveWatchSegments. All state is effect-local — a
  // re-run for the next episode starts clean, and the cleanup's flush
  // closes over the DEPARTING episode's id, so auto-advance (which swaps
  // current.id without remounting the element) can never cross-write.
  // Continuous playback marks a bucket once (lastMarked); a seek resets
  // lastMarked so re-crossing counts again — that re-count is the rewatch
  // peak on the admin retention curve, not a bug.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !playback) return;
    const episodeId = current.id;
    const pending = new Set<number>();
    let lastMarked: number | null = null;

    const flush = () => {
      if (pending.size === 0) return;
      const buckets = [...pending];
      pending.clear();
      void saveWatchSegments(episodeId, buckets).catch(() => {});
    };
    const onTimeUpdate = () => {
      // Mid-auto-advance the element still holds the previous episode
      // (snapshot trails current.id) — same guard as the progress flush.
      if (el.paused || playback.episodeId !== episodeId) return;
      const bucket = Math.floor(
        (el.currentTime ?? 0) / WATCH_SEGMENT_BUCKET_SECONDS,
      );
      if (bucket !== lastMarked) {
        pending.add(bucket);
        lastMarked = bucket;
      }
    };
    const onSeeking = () => {
      lastMarked = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      flush();
    }, 20_000);

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("seeking", onSeeking);
    el.addEventListener("ended", flush);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(interval);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("seeking", onSeeking);
      el.removeEventListener("ended", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [current.id, playback]);

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

  // Fork prompt window (#144) — the fourth timeupdate consumer, shaped like
  // the skip-intro chip: open while `duration - currentTime` is inside the
  // parent's fork window, closed outside it (a seek back out of the window
  // closes it; a pick already made stays). The overlay's countdown is this
  // same clock in whole seconds — the transition itself happens at `ended`
  // through the gapless path, so a pause pauses the countdown and nothing
  // here ever pauses the video. Guards mirror the prefetch effect's: right
  // after an advance the element still reports the FINISHED episode. Also
  // computes the token-refresh hold (prompt open, or the end < tail away).
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !playback || playback.episodeId !== current.id) return;
    const windowSeconds = fork ? current.forkWindowSeconds : 0;
    const update = () => {
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0 || el.ended) return;
      const remaining = dur - (el.currentTime ?? 0);
      refreshHoldRef.current =
        remaining <= Math.max(windowSeconds, REFRESH_HOLD_TAIL_SECONDS);
      if (!fork) return;
      const open = remaining <= windowSeconds;
      setForkOpen(open);
      if (open) setForkRemaining(Math.max(0, Math.ceil(remaining)));
    };
    update();
    el.addEventListener("timeupdate", update);
    return () => {
      el.removeEventListener("timeupdate", update);
      refreshHoldRef.current = false;
    };
  }, [playback, current.id, current.forkWindowSeconds, fork]);

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

  // Prefetch the playback token of EVERY transition candidate (#144: the
  // single follower, or all of a fork's options) once the playhead is
  // within PRELOAD_LEAD_SECONDS of the end, so the gapless path skips the
  // token round-trip whichever way the viewer goes (the hidden preloaders
  // below warm the streams themselves). Trial mode is excluded: its token
  // TTL is the preview's remaining seconds — a prefetched trial token is
  // dead by the time it's needed, and a 60s preview ends at the paywall,
  // not the next episode. Prefetch failures are deliberately silent: the
  // advance path falls back to a fetch-on-swap, which still reuses the
  // live element.
  useEffect(() => {
    if (!playback || playback.episodeId !== current.id) return;
    if (mode === "trial") return;
    const targets = candidateEpisodes.filter(
      (e) => !isEpisodeLocked(e.tier, mode),
    );
    if (targets.length === 0) return;
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;
    const check = () => {
      // Right after an auto-advance the element still holds the FINISHED
      // episode (ended, remaining 0) until the new src installs — without
      // this guard the boundary check() would prefetch the next-NEXT
      // episode immediately instead of PRELOAD_LEAD_SECONDS before the end.
      if (el.ended) return;
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (dur - el.currentTime > PRELOAD_LEAD_SECONDS) return;
      for (const target of targets) {
        if (prefetchAttemptedRef.current.has(target.id)) continue;
        prefetchAttemptedRef.current.add(target.id);
        const targetId = target.id;
        fetch(
          `/api/playback-token?episode_id=${encodeURIComponent(targetId)}`,
          { cache: "no-store" },
        )
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
            const prefetched: TokenPrefetch = {
              token: data.token,
              expiresAt: Date.now() + data.expiresIn * 1000,
              mode:
                data.mode === "free" || data.mode === "member"
                  ? data.mode
                  : null,
            };
            setPrefetches((p) => ({ ...p, [targetId]: prefetched }));
          })
          .catch(() => {});
      }
    };
    check();
    el.addEventListener("timeupdate", check);
    return () => {
      cancelled = true;
      el.removeEventListener("timeupdate", check);
    };
  }, [playback, current.id, mode, candidateEpisodes]);

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
        episodeLabel={`S${signupWallTarget.seasonNumber}·E${displayNumber(episodes, signupWallTarget)}`}
        targetEpisodeId={signupWallTarget.id}
        episodeNumber={listedPosition(episodes, signupWallTarget.id)}
        memberCount={memberCount}
        backdropThumbnailUrl={current.thumbnailUrl}
        gate={signupGate}
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
      <div className="relative z-10 flex items-center gap-3 text-cream/60">
        <span className="size-2 animate-pulse rounded-full bg-gold" />
        <span className="text-xs font-semibold uppercase tracking-[0.3em]">
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
          className="absolute inset-x-0 top-0 z-[1] h-[130px] bg-gradient-to-b from-black/75 to-transparent"
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 z-[1] h-[200px] bg-gradient-to-t from-black/85 to-transparent"
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
          className="group absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-cream"
        >
          <span className="bg-gold-cta flex h-[72px] w-[72px] items-center justify-center rounded-full text-gold-deep shadow-play transition-transform duration-150 group-hover:scale-105">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={32} />
            </span>
          </span>
          <span className="text-xs font-semibold uppercase tracking-[0.3em] text-cream/80">
            {mode === "free" ? t.player.playFreeEpisode : t.player.playPreview}
          </span>
        </button>
        <Link
          href={`/shows/${showSlug}`}
          aria-label={t.player.backToShowAria}
          className="absolute left-5 top-5 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-rust/60 bg-burgundy/50 text-cream backdrop-blur-xl transition-colors hover:bg-burgundy/70 sm:left-8"
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
    "--media-primary-color": "#f6efe4",
    "--media-secondary-color": "transparent",
    "--media-text-color": "#f6efe4",
    "--media-control-background": "transparent",
    "--media-control-hover-background": "rgba(246,239,228,0.08)",
    // Progress = gold: cream/22 track, #e6b366 fill, gold scrubber knob with
    // a soft gold halo (design player language).
    "--media-range-bar-color": "#e6b366",
    "--media-range-track-background": "rgba(246,239,228,0.22)",
    "--media-range-track-border-radius": "9999px",
    "--media-range-track-height": "4px",
    "--media-range-thumb-background": "#e6b366",
    "--media-range-thumb-border-radius": "9999px",
    "--media-range-thumb-width": "14px",
    "--media-range-thumb-height": "14px",
    "--media-range-thumb-box-shadow": "0 0 0 4px rgba(230,179,102,0.25)",
    "--media-tooltip-display": "none",
    // Letterbox the slotted <video> inside the controller (media-chrome's
    // default, pinned explicitly): a no-op for the standard layout (its box
    // matches the asset ratio) and what makes the full-bleed vertical layout
    // centre a 9:16 asset with black bars instead of cropping or stretching.
    "--media-object-fit": "contain",
    "--media-font-family":
      "var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif",
    // Settings / rendition menu — espresso-2 panel, gold selection.
    "--media-menu-background": "rgba(26, 18, 12, 0.96)",
    "--media-menu-border": "1px solid rgba(168, 64, 31, 0.3)",
    "--media-menu-border-radius": "12px",
    "--media-menu-padding": "6px",
    "--media-menu-item-border-radius": "8px",
    "--media-menu-item-checked-bg": "rgba(230, 179, 102, 0.15)",
    "--media-menu-item-checked-color": "#e6b366",
    "--media-menu-item-hover-background": "rgba(230, 179, 102, 0.12)",
    "--media-menu-icon-color": "#f6efe4",
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
          // Meta Lead = "finished the first episode of a show" (2026-07-19
          // remap; earlier homes — the subscription Paywall, briefly the
          // SignupWall — no longer fire it). A completed first episode is
          // the hooked-viewer signal, the browser-side twin of the
          // dashboard's North-Star deep-watch metric. Fires before the
          // advance/overlay branches below so every end-path counts (auto-
          // advance, series end, wall). Once per browser via the historical
          // matio:fb:lead flag — Lead ≈ unique hooked prospects, not
          // finishes; the flag is set only AFTER the fire so a not-yet-
          // loaded SDK doesn't burn it, and consent stays enforced by the
          // pixel-ready deferral (no consent → no fbq → no fire).
          if (currentPosition === 1) {
            const leadKey = "matio:fb:lead";
            let leadDone = false;
            try {
              leadDone = !!localStorage.getItem(leadKey);
            } catch {
              // Storage blocked (private mode): fire anyway.
            }
            if (!leadDone) {
              onPixelReady(() => {
                trackPixel("Lead", {
                  content_category: "first_episode_finished",
                  content_type: "product",
                  content_ids: [showSlug],
                });
                try {
                  localStorage.setItem(leadKey, "1");
                } catch {
                  // ignore storage write failures
                }
              });
            }
          }
          const el = videoRef.current;
          if (el) {
            const t = Math.floor(el.duration ?? 0);
            if (mode === "trial" || mode === "free") {
              void saveTrialPosition(current.id, t).catch(() => {});
            } else {
              void saveWatchProgress(current.id, t, true).catch(() => {});
            }
          }
          // Where to go (#144): at a fork, the viewer's pick — or the
          // default when the clock ran out untouched; otherwise the single
          // follower. Null = nothing follows (last listed episode, or a
          // branch that is an ending): the series-end surfaces below.
          const pick = fork
            ? (fork.options.find((o) => o.episode.id === forkChosenId) ??
              fork.defaultOption)
            : null;
          // The choice is a fact of the fork, whatever the target does next
          // (plays, hits a wall, or shows the trial's up-next card) — fire it
          // here, before the branching below. Ids and flags only.
          if (pick) {
            capturePostHog("fork_choice_made", {
              show_slug: showSlug,
              episode_id: current.id,
              choice_position: pick.position,
              is_default: pick.isDefault,
              timed_out: forkChosenId === null,
            });
          }
          const target: PlayerEpisode | null = pick ? pick.episode : next;
          if (target) {
            if (isEpisodeLocked(target.tier, mode)) {
              // Auto-advance into the locked episode: the swap remounts the
              // inner player which renders the right wall full-surface, and
              // ?ep=<locked id> lands in the URL so the post-signup redirect
              // resumes exactly there. No up-next countdown into a wall.
              onSwap(target.id);
            } else if (mode === "trial") {
              // Legacy 60s preview: keep the countdown card. The preview
              // ends at the paywall, not the next episode — instant
              // advance would burn the remaining seconds on a transition
              // the user didn't choose.
              onOverlayChange("upnext");
            } else {
              // Instant auto-advance: same <video> element, new src — and
              // a fork transition is exactly this path with the viewer
              // choosing `target`. Install the prefetched token here
              // (falling back to the fetch effect when it's missing or
              // about to expire) — the first-play effect then starts the
              // new episode on the still-blessed element. This handler is
              // the only entry into the gapless path, so all per-episode
              // refs reset here too (the render-phase block handles the
              // visual state).
              const targetPosition = listedPosition(episodes, target.id);
              capturePostHog("episode_auto_advanced", {
                show_slug: showSlug,
                from_episode: currentPosition,
                to_episode: targetPosition,
              });
              lastSavedRef.current = 0;
              firstFrameFiredRef.current = false;
              tierStartFiredRef.current = false;
              prefetchAttemptedRef.current = new Set();
              errorTimesRef.current = [];
              resumeAfterRefreshRef.current = null;
              wasPlayingRef.current = false;
              pausedByUserRef.current = false;
              const prefetched = prefetches[target.id];
              if (prefetched && prefetched.expiresAt > Date.now() + 5_000) {
                setPlayback({
                  episodeId: target.id,
                  playbackId: target.playbackId,
                  token: prefetched.token,
                  expiresAt: prefetched.expiresAt,
                });
                // The fetch effect — the usual emitter of the tier-start
                // funnel events — is skipped on this path, so fire from
                // the prefetched response's mode instead.
                if (
                  prefetched.mode === "free" ||
                  prefetched.mode === "member"
                ) {
                  tierStartFiredRef.current = true;
                  capturePostHog(
                    prefetched.mode === "free"
                      ? "free_episode_started"
                      : "member_episode_started",
                    {
                      show_slug: showSlug,
                      episode_number: targetPosition,
                    },
                  );
                }
              }
              // No usable prefetch: keep the old snapshot mounted (paused
              // on its end frame) so the element survives; the token-fetch
              // effect sees playback.episodeId !== current.id and swaps in
              // place (firing the tier events itself).
              setPrefetches({});
              setChipEpisodeId(target.id);
              onAdvance(target.id);
            }
          } else if (mode === "subscriber" || freeMode) {
            // Last episode of the show finished. Subscribers see the
            // "next episode in production" reminder sheet. Trial users
            // realistically can't reach this branch (60s preview vs
            // full episode duration); skip the overlay for them so a
            // freak edge case — say a 30s teaser — doesn't dump a paid
            // surface on a free preview.
            //
            // freeMode: with payments off the member/free walls below
            // must never mount — every viewer gets the same neutral
            // series-end sheet.
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
          episodeNumber={currentNumber}
          durationSeconds={current.durationSeconds}
          episodesCount={listed.length}
          hasNext={!!next}
          hasCaptions={hasCaptions}
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
      {/* Top scrim + bar */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/75 to-transparent px-5 pb-16 pt-5 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:px-8 sm:pt-[22px]`}
      >
        <div className="pointer-events-auto flex items-center gap-4">
          <Link
            href={`/shows/${showSlug}`}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rust/60 bg-burgundy/50 text-cream backdrop-blur-xl transition-colors hover:bg-burgundy/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold/60 sm:h-[42px] sm:w-[42px]"
            aria-label={t.player.backToShowAria}
          >
            <Icon name="back" size={19} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-sm uppercase leading-none tracking-[0.03em] text-cream sm:text-[17px]">
              {showTitle ?? current.title}
            </h1>
            <p className="mt-1 truncate text-[11px] font-semibold leading-none text-cream/60 sm:text-xs">
              {t.home.epShort(currentNumber)} · {current.title}
            </p>
          </div>
          {/* Right cluster of translucent-black circles. AirPlay + captions
              auto-hide (no target / no real text track). The settings gear
              is the rendition-menu trigger, moved up from the bottom bar. */}
          <div className="flex shrink-0 items-center gap-2.5 text-cream">
            {/* No display override on the auto-hiding buttons (AirPlay,
                rendition): media-chrome toggles their host display to hide
                them, and its :host already centers the slotted icon — a
                forced `flex` would pin them visible. Size + circle only. */}
            <MediaAirplayButton
              className="h-9 w-9 rounded-full !bg-black/40 !p-0 text-current backdrop-blur-xl transition-colors hover:text-cream sm:h-[42px] sm:w-[42px]"
              aria-label={t.player.castAria}
            >
              <span slot="icon" className="contents">
                <Icon name="cast" size={19} />
              </span>
            </MediaAirplayButton>
            {hasCaptions ? (
              <MediaCaptionsButton
                className="h-9 w-9 rounded-full !bg-black/40 !p-0 text-current backdrop-blur-xl transition-colors hover:text-cream sm:h-[42px] sm:w-[42px]"
                aria-label={t.player.captionsAria}
              >
                <span slot="icon" className="contents">
                  <Icon name="subtitle" size={19} />
                </span>
              </MediaCaptionsButton>
            ) : null}
            {/* Settings / quality gear — the rendition-menu trigger (menu
                itself is pinned bottom-right so it has room to anchor
                without clipping). Auto-hides when the stream has a single
                rendition. */}
            <MediaRenditionMenuButton
              className="h-9 w-9 rounded-full !bg-black/40 !p-0 text-current backdrop-blur-xl transition-colors hover:text-cream sm:h-[42px] sm:w-[42px]"
              aria-label={t.player.qualityAria}
            >
              <span slot="icon" className="contents">
                <Icon name="settings" size={19} />
              </span>
            </MediaRenditionMenuButton>
          </div>
        </div>
      </div>

      {/* Center cluster */}
      <div
        className={`pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0`}
      >
        {/* prev-episode · gold play/pause · next-episode. The seek clusters
            the design removed are replaced by episode transport — the
            scrubber covers in-episode seeking. Prev/next hide when there is
            no adjacent episode; both swap via onSwap (manual-swap remount). */}
        <div className="pointer-events-auto flex items-center gap-11 text-cream sm:gap-14">
          {prev ? (
            <button
              type="button"
              onClick={() => onSwap(prev.id)}
              aria-label={t.player.prevAria}
              className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-full bg-black/40 text-cream backdrop-blur-xl transition-transform hover:scale-105 active:scale-95 sm:h-[58px] sm:w-[58px]"
            >
              <Icon name="rewind" size={22} />
            </button>
          ) : null}
          <MediaPlayButton
            className="!flex items-center justify-center !bg-transparent !p-0"
            aria-label={t.player.playPauseAria}
          >
            <span slot="play" className="contents">
              <span className="bg-gold-cta flex h-[68px] w-[68px] items-center justify-center rounded-full text-gold-deep shadow-play transition-transform hover:scale-105 sm:h-[92px] sm:w-[92px]">
                <span className="-mr-1 inline-flex">
                  <Icon name="play" size={32} />
                </span>
              </span>
            </span>
            <span slot="pause" className="contents">
              <span className="bg-gold-cta flex h-[68px] w-[68px] items-center justify-center rounded-full text-gold-deep shadow-play transition-transform hover:scale-105 sm:h-[92px] sm:w-[92px]">
                <Icon name="pause" size={32} />
              </span>
            </span>
          </MediaPlayButton>
          {next ? (
            <button
              type="button"
              onClick={() => onSwap(next.id)}
              aria-label={t.player.nextAria}
              className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-full bg-black/40 text-cream backdrop-blur-xl transition-transform hover:scale-105 active:scale-95 sm:h-[58px] sm:w-[58px]"
            >
              <Icon name="forward" size={22} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Skip-intro chip — only renders when in the intro window and the
          chrome isn't locked. */}
      {showSkipIntro && current.introEndSeconds != null ? (
        <button
          type="button"
          onClick={() => {
            const el = videoRef.current;
            if (el && current.introEndSeconds != null) {
              el.currentTime = current.introEndSeconds;
            }
          }}
          className="bg-gold-cta absolute bottom-[124px] right-5 z-20 inline-flex h-[42px] items-center rounded-full px-[22px] text-[13px] font-extrabold text-gold-deep shadow-cta transition-transform hover:scale-[1.02] active:scale-[0.98] sm:right-8"
        >
          {t.player.skipIntro}
        </button>
      ) : null}

      {/* "Tap for sound" pill — autoplay landed in the muted fallback. */}
      {showUnmutePill ? (
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
          className="absolute bottom-[124px] left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-xs font-bold text-cream backdrop-blur-xl transition-colors hover:bg-black/70"
        >
          <Icon name="mute" size={14} className="text-gold" />
          {t.player.tapForSound}
        </button>
      ) : null}

      {/* Tap-to-play — autoplay fully blocked (e.g. iOS Low Power Mode);
          playback-core leaves the element paused with no signal, so this
          is our own affordance. The tap doubles as the gesture that
          blesses the element for unmuted auto-advance later. */}
      {needsTap ? (
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
          <span className="bg-gold-cta flex h-[72px] w-[72px] items-center justify-center rounded-full text-gold-deep shadow-play">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={32} />
            </span>
          </span>
        </button>
      ) : null}

      {/* Transient "Up next" chip right after an auto-advance, so the
          instant cut doesn't disorient. */}
      {chipEpisodeId === current.id ? (
        <div className="pointer-events-none absolute left-1/2 top-5 z-20 max-w-[80%] -translate-x-1/2 truncate rounded-full border border-rust/30 bg-black/60 px-4 py-2 text-xs font-semibold text-cream backdrop-blur-xl">
          {t.player.upNextBtn} · {t.home.epShort(currentNumber)} — {current.title}
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
          <span className="size-2 animate-pulse rounded-full bg-gold" />
        </div>
      ) : null}

      {!verticalLayout && (
        <>
      {/* Mini Matio branding */}
      <div
        className={`pointer-events-none absolute bottom-[92px] left-5 z-10 opacity-50 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:left-8`}
      >
        <MatioLogo size={11} />
      </div>

      {/* Bottom bar. Side/bottom padding honors iOS landscape notch +
          home-indicator safe-area; floors keep the original 1.25rem/2rem
          cushion on devices with no inset. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent pt-4 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pl-[max(env(safe-area-inset-left),2rem)] sm:pr-[max(env(safe-area-inset-right),2rem)]`}
      >
        {/* Gold scrubber — knob/track/fill themed via mediaVars. */}
        <MediaTimeRange className="!block !h-3 !w-full !bg-transparent" />
        {/* Control row: timecode (elapsed / duration, Geist Mono) left;
            right cluster — volume, Episodes pill, playback-rate, fullscreen,
            and the kept lock toggle (not in the design; retained for
            function). Wraps on very narrow letterbox widths so the row can't
            overflow. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2 text-cream/85">
          <MediaTimeDisplay
            showDuration
            className="!bg-transparent !p-0 font-mono !text-xs !font-semibold tabular-nums !text-cream/80"
          />
          <div className="flex items-center gap-3 sm:gap-4">
            <MediaMuteButton
              className="!bg-transparent !p-0 pointer-coarse:!p-2 text-cream transition-opacity hover:opacity-80"
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
              onClick={() => onOverlayChange("episodes")}
              className="inline-flex h-9 items-center rounded-full border border-cream/25 px-4 text-xs font-bold text-cream transition-colors hover:bg-cream/10"
            >
              {t.player.episodesBtn}
            </button>
            <MediaPlaybackRateButton
              rates={[0.5, 1, 1.25, 1.5, 2]}
              className="!bg-transparent !p-0 font-mono !text-xs !font-bold !text-cream/80 transition-opacity hover:!opacity-80"
              aria-label={t.player.rateAria}
            />
            <MediaFullscreenButton
              className="!bg-transparent !p-0 pointer-coarse:!p-2 text-cream transition-opacity hover:opacity-80"
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

      {/* Rendition (quality) menu — pinned to the top-right of the player,
          directly under its gear trigger in the top bar. We bypass
          media-chrome's auto-anchor positioning (which was clipping the
          menu against the player edge) by positioning it explicitly; the
          max-height keeps long rendition lists scrollable on short
          viewports. The button still toggles it via media-chrome's
          internal invoker wiring. */}
      <MediaRenditionMenu
        hidden
        anchor="auto"
        className="!absolute !right-5 !top-[72px] z-30 !max-h-[60vh] !overflow-y-auto !font-sans sm:!right-8 sm:!top-[88px]"
        style={{ minWidth: "180px" }}
      />

        </>
      )}

      {/* Hidden preloaders — one per transition candidate (#144). The one
          that plays if nothing is tapped (the single follower, or a fork's
          default / the viewer's pick) warms from ~PRELOAD_LEAD_SECONDS at
          preload="auto": ~30s of its stream lands in the browser HTTP cache
          for the visible player's re-init (Mux segment URLs are
          deterministic and cacheable for a week; playlists are no-store but
          tiny). A fork's OTHER options mount only while the prompt is open,
          at preload="metadata" (manifest + first segment) — three full
          buffers in the last seconds would starve the visible player on a
          slow link. A pick promotes its option to "auto" in place: the
          wrapper forwards preload changes through setPreload, no remount.
          display:none — never slotted as media; Mux Data force-disabled
          (hard-coded, NOT the visible element's consent form) so a
          preloader can neither count phantom views nor drop viewer cookies
          before consent. */}
      {candidateEpisodes.map((e) => {
        const prefetched = prefetches[e.id];
        if (!prefetched) return null;
        const willPlay =
          !fork || e.id === (forkChosenId ?? fork.defaultOption.episode.id);
        if (!willPlay && !forkOpen) return null;
        return (
          <MuxVideo
            key={e.id}
            style={{ display: "none" }}
            aria-hidden
            muted
            playsInline
            preload={willPlay ? "auto" : "metadata"}
            playbackId={e.playbackId}
            tokens={{ playback: prefetched.token }}
            streamType="on-demand"
            disableTracking
            disableCookies
          />
        );
      })}

      {/* Overlays */}
      {/* The episodes list is the LISTED run only — a branch is reachable
          through a choice, never by position; while one plays, the row
          of the episode it continues reads as "now playing". */}
      {overlay === "episodes" ? (
        <EpisodesOverlay
          episodes={listed}
          currentEpisodeId={anchor.id}
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
      {/* Fork prompt (#144): portaled like the others (media-chrome treats
          a click inside its subtree as a play/pause gesture), one overlay
          for both chromes. Open only inside the parent's fork window; the
          pick lands in forkChosenId and the `ended` handler takes it. */}
      {fork && forkOpen ? (
        <ForkChoiceOverlay
          prompt={current.forkPrompt ?? ""}
          options={fork.options.map((o) => ({
            episodeId: o.episode.id,
            label: o.label,
            isDefault: o.isDefault,
          }))}
          chosenId={forkChosenId}
          remainingSeconds={forkRemaining}
          windowSeconds={current.forkWindowSeconds}
          onChoose={setForkChosenId}
        />
      ) : null}
    </MediaController>
  );
}
