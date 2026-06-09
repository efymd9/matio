"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MuxVideo from "@mux/mux-video-react";
import { useMarketingConsent } from "@/lib/use-marketing-consent";

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
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";
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

// Whether `mode` may play an episode of `tier`. Subscriber and legacy-trial
// modes never lock (trial gating is the 60s clock, not position).
export function isEpisodeLocked(tier: EpisodeTier, mode: Mode): boolean {
  if (mode === "subscriber" || mode === "trial") return false;
  if (mode === "member") return tier === "subscriber";
  return tier !== "free"; // mode === "free"
}

type OverlayKind = "none" | "episodes" | "seriesEnd";

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
// EpisodePlayback is keyed on current.id, so swapping episodes unmounts
// and remounts it, which is what naturally resets per-episode state
// (token, paywall, aspect ratio, captions, skip-intro, last-saved
// position) without needing setState calls at the top of effects.
export function Player({
  episodes,
  initialEpisodeId,
  mode,
  showId,
  showSlug,
  showTitle,
  resumeSeconds,
  userEmail,
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
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [currentEpisodeId, setCurrentEpisodeId] = useState(initialEpisodeId);
  const [overlay, setOverlay] = useState<OverlayKind>("none");
  const [locked, setLocked] = useState(false);
  // Mute is shared across episodes so an auto-advance keeps the viewer's
  // sound choice. Starts muted because autoplay-with-sound is blocked on a
  // fresh page load (no prior user gesture) — the inner player shows a
  // tap-to-unmute pill, and once the user unmutes, the page has a user
  // activation so subsequent auto-advances keep playing with sound.
  const [muted, setMuted] = useState(true);
  // trial_play_started (PostHog) fires once per show-preview session, not per
  // episode — the ref lives in the outer shell so swapping episodes mid-trial
  // doesn't re-fire it. No-op without marketing consent (PostHog isn't loaded).
  // The Meta Pixel Lead used to fire here too; it now fires on signup
  // completion instead (components/site/complete-registration-pixel.tsx).
  const trialStartFiredRef = useRef(false);
  const onTrialStart = useCallback(() => {
    if (trialStartFiredRef.current) return;
    trialStartFiredRef.current = true;
    capturePostHog("trial_play_started", {
      show_slug: showSlug,
      show_title: showTitle ?? showSlug,
    });
  }, [showTitle, showSlug]);

  // Now that playback autostarts on landing (no poster play-gate), the
  // play_attempted funnel event fires once per show-preview session for
  // trial/free modes — it marks "we tried to autoplay", paired with
  // first_frame ("it actually rendered") to measure autoplay-block bounce.
  // Deferred via onPostHogReady so the consent-gated SDK has a chance to load
  // (same as other mount-time funnel events); deps are page-stable so it runs
  // once. The shell isn't remounted on episode swap.
  useEffect(() => {
    if (mode !== "trial" && mode !== "free") return;
    return onPostHogReady(() => {
      capturePostHog("play_attempted", {
        show_slug: showSlug,
        show_title: showTitle ?? showSlug,
      });
    });
  }, [mode, showSlug, showTitle]);

  // Prefetched-token cache, keyed by episode id. While an episode plays we
  // fetch the NEXT episode's playback token ahead of time and stash it here;
  // the inner player consumes it on mount instead of doing a round-trip, so
  // an auto-advance starts without waiting on /api/playback-token. Tokens
  // carry their own absolute expiry so a stale entry is ignored.
  const tokenCacheRef = useRef<
    Map<string, { token: string; expiresAt: number; mode: string }>
  >(new Map());
  const prefetchToken = useCallback(async (episodeId: string) => {
    const cached = tokenCacheRef.current.get(episodeId);
    // Skip if a still-comfortably-valid entry exists (>65s of headroom).
    if (cached && cached.expiresAt - Date.now() > 65_000) return;
    try {
      const r = await fetch(
        `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
        { cache: "no-store" },
      );
      if (!r.ok) return; // 403/429/5xx — let the real mount surface it.
      const data = (await r.json()) as {
        token: unknown;
        expiresIn: unknown;
        mode?: unknown;
      };
      if (typeof data.token === "string" && typeof data.expiresIn === "number") {
        tokenCacheRef.current.set(episodeId, {
          token: data.token,
          expiresAt: Date.now() + data.expiresIn * 1000,
          mode: typeof data.mode === "string" ? data.mode : "",
        });
      }
    } catch {
      // Best-effort warm-up — a failure just means the real mount fetches.
    }
  }, []);
  const takeCachedToken = useCallback((episodeId: string) => {
    const cached = tokenCacheRef.current.get(episodeId);
    if (cached && cached.expiresAt - Date.now() > 5_000) return cached;
    return null;
  }, []);

  const current = useMemo(
    () => episodes.find((e) => e.id === currentEpisodeId) ?? episodes[0],
    [episodes, currentEpisodeId],
  );
  const currentIdx = episodes.findIndex((e) => e.id === current.id);
  const next: PlayerEpisode | null =
    currentIdx >= 0 && currentIdx < episodes.length - 1
      ? episodes[currentIdx + 1]
      : null;

  // Only honor server-provided resume on the initially loaded episode;
  // subsequent swaps start from 0 by design.
  const resumeForThisLoad =
    current.id === initialEpisodeId ? (resumeSeconds ?? null) : null;

  // Swap to a different episode — updates the URL, closes any open
  // overlay, and triggers the inner remount via the key change.
  const swap = useCallback(
    (episodeId: string) => {
      if (episodeId === currentEpisodeId) {
        setOverlay("none");
        return;
      }
      setCurrentEpisodeId(episodeId);
      setOverlay("none");
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      sp.set("ep", episodeId);
      // Resume only applies to the initial render — strip it so a swap
      // doesn't replay a stale offset.
      sp.delete("resume");
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [currentEpisodeId, pathname, router, searchParams],
  );

  return (
    <EpisodePlayback
      key={current.id}
      current={current}
      next={next}
      episodes={episodes}
      mode={mode}
      showId={showId}
      showSlug={showSlug}
      showTitle={showTitle}
      resumeSeconds={resumeForThisLoad}
      locked={locked}
      onLockChange={setLocked}
      muted={muted}
      onMutedChange={setMuted}
      overlay={overlay}
      onOverlayChange={setOverlay}
      onSwap={swap}
      onTrialStart={onTrialStart}
      prefetchToken={prefetchToken}
      takeCachedToken={takeCachedToken}
      userEmail={userEmail}
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
  locked,
  onLockChange,
  muted,
  onMutedChange,
  overlay,
  onOverlayChange,
  onSwap,
  onTrialStart,
  prefetchToken,
  takeCachedToken,
  userEmail,
}: {
  current: PlayerEpisode;
  next: PlayerEpisode | null;
  episodes: PlayerEpisode[];
  mode: Mode;
  showId: string;
  showSlug: string;
  showTitle?: string;
  resumeSeconds: number | null;
  locked: boolean;
  onLockChange: (locked: boolean) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  overlay: OverlayKind;
  onOverlayChange: (overlay: OverlayKind) => void;
  onSwap: (episodeId: string) => void;
  onTrialStart: () => void;
  prefetchToken: (episodeId: string) => void;
  takeCachedToken: (
    episodeId: string,
  ) => { token: string; expiresAt: number; mode: string } | null;
  userEmail?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const t = useT();
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
  // Consume any prefetched token for this episode (warmed by the shell while
  // the previous episode played) ONCE at mount. The inner is keyed on
  // current.id, so this memo runs fresh per episode. Seeding token/expiresAt
  // from it via lazy initial state — rather than setState in an effect — keeps
  // the auto-advance round-trip-free without a cascading-render lint trip.
  const cachedInitial = useMemo(
    () => takeCachedToken(current.id),
    [current.id, takeCachedToken],
  );
  const [token, setToken] = useState<string | null>(
    cachedInitial?.token ?? null,
  );
  const [expiresAt, setExpiresAt] = useState<number | null>(
    cachedInitial?.expiresAt ?? null,
  );
  const [endState, setEndState] = useState<EndState | null>(null);
  // Bumped by retry() — included in the token-fetch effect's deps so the
  // fetch reruns without unmounting the inner playback component (which
  // would also tear down the MediaController and any captured renditions).
  const [fetchKey, setFetchKey] = useState(0);
  const retry = useCallback(() => {
    setEndState(null);
    setToken(null);
    setExpiresAt(null);
    setFetchKey((k) => k + 1);
  }, []);
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  // Whether the underlying media element exposes at least one real
  // caption/subtitle track. media-chrome's built-in auto-hide on
  // <MediaCaptionsButton> doesn't catch every case (Mux sometimes surfaces
  // empty/CEA-608 placeholders), so we gate the button on our own check.
  const [hasCaptions, setHasCaptions] = useState(false);
  // Live aspect ratio of the playing asset, read off the video element
  // once metadata is available. Default 16:9 so the first paint isn't a
  // zero-height container; corrects to e.g. 9/16 for portrait shorts
  // within ~200ms of the manifest arriving.
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const supportsAspectRatio = SUPPORTS_ASPECT_RATIO;
  // Rolling timestamps of recent video <error> events. A single decode
  // hiccup on cellular is normal noise; we only surrender the slot to
  // PlaybackUnavailable when 3 errors land inside a 10s window.
  const errorTimesRef = useRef<number[]>([]);
  // Subscriber token-refresh remounts <MuxVideo> (keyed on token) because the
  // wrapper only rebuilds its HLS src on a playbackId change, never on a
  // tokens-only change — so a refreshed token can't reach hls.js otherwise.
  // Capture playhead + play-state before the swap and restore them on the new
  // element's loadedmetadata so the remount is seamless. Trial tokens are never
  // refreshed, so this only fires for subscribers (~once an hour).
  const resumeAfterRefreshRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
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

  // Fetch playback token on mount. Playback now autostarts on landing (no
  // poster play-gate), so the trial row is minted — and the 60s clock starts
  // — as soon as the watch URL loads. Inner is keyed on current.id, so this
  // runs once per episode-mount; per-episode state starts at its initial value
  // (no setState resets at the top of the effect body).
  //
  // First it tries a prefetched token from the shell cache (an auto-advance
  // warms the next episode's token while the current one plays) so the swap
  // doesn't wait on a round-trip. A retry() (fetchKey > 0) always refetches.
  // Branches on response status so that a 429 / 5xx / parse failure
  // doesn't get framed as a "preview ended" paywall. AbortController
  // cancels the in-flight fetch on episode swap so a slow response
  // can't race the new episode's fetch.
  useEffect(() => {
    if (currentLocked) return;
    // Prefetched token already seeded into state (lazy initial). Just fire the
    // per-episode start analytics and skip the network round-trip. A retry()
    // (fetchKey > 0) cleared the token, so it always falls through to a fresh
    // fetch below.
    if (fetchKey === 0 && cachedInitial) {
      if (cachedInitial.mode === "trial") onTrialStart();
      if (
        (cachedInitial.mode === "free" || cachedInitial.mode === "member") &&
        !tierStartFiredRef.current
      ) {
        tierStartFiredRef.current = true;
        capturePostHog(
          cachedInitial.mode === "free"
            ? "free_episode_started"
            : "member_episode_started",
          { show_slug: showSlug, episode_number: currentPosition },
        );
      }
      return;
    }
    const hasAbort = typeof AbortController !== "undefined";
    const abort = hasAbort ? new AbortController() : null;
    let cancelled = false;
    fetch(
      `/api/playback-token?episode_id=${encodeURIComponent(current.id)}`,
      { cache: "no-store", ...(abort ? { signal: abort.signal } : {}) },
    )
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setEndState(await classifyTokenFailure(r));
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
          setToken(data.token);
          setExpiresAt(Date.now() + data.expiresIn * 1000);
          // Trial-mode token issued → a 60s preview just started. Fire the
          // trial_play_started funnel event (deduped to once per show-preview
          // by the shell). The Meta Lead now fires on signup completion.
          if (data.mode === "trial") onTrialStart();
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
    fetchKey,
    onTrialStart,
    cachedInitial,
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
    if (!expiresAt) return;
    const REFRESH_LEAD_MS = 60_000;
    const remaining = expiresAt - Date.now();

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
            `/api/playback-token?episode_id=${encodeURIComponent(current.id)}`,
            { cache: "no-store", ...(abort ? { signal: abort.signal } : {}) },
          );
          if (r.ok) {
            if (cancelled) return;
            const data = (await r.json()) as {
              token: unknown;
              expiresIn: unknown;
            };
            if (
              typeof data.token === "string" &&
              typeof data.expiresIn === "number"
            ) {
              // Capture playhead + play-state before the token swap remounts
              // <MuxVideo> (key={token}); restored on its loadedmetadata. The
              // old token is still valid here (we're REFRESH_LEAD_MS ahead of
              // expiry), so playback keeps running until React commits the
              // new element.
              const el = videoRef.current;
              if (el) {
                resumeAfterRefreshRef.current = el.currentTime;
                wasPlayingRef.current = !el.paused;
              }
              setToken(data.token);
              setExpiresAt(Date.now() + data.expiresIn * 1000);
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
  }, [expiresAt, current.id, mode]);

  // Save progress every 10s while playing AND visible. On tab hide
  // (visibilitychange/pagehide) we flush a final save immediately —
  // otherwise mobile users lose up to 10s every time they background
  // the app. Skipping ticks while hidden also saves battery on long
  // backgrounded tabs.
  useEffect(() => {
    const flush = () => {
      const el = videoRef.current;
      if (!el) return;
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
  }, [current.id, mode]);

  // Keep the underlying media element's `muted` property in sync with the
  // shared state. React can be unreliable about reflecting the `muted` prop
  // onto a media element (it sets the attribute, not always the property), and
  // a muted autoplay only succeeds if the element is actually muted at play()
  // time — so we enforce it imperatively. Re-runs on token (the <MuxVideo>
  // remounts on a subscriber token refresh, reattaching videoRef). Writing the
  // same value React already reflects is a no-op; the volumechange it may emit
  // just echoes the current state.
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.muted = muted;
  }, [muted, token]);

  // Seek to resume position once the player has metadata for the episode.
  // This is the server-provided resume and applies only on the initial episode
  // load. A subscriber token-refresh remount also re-runs this effect (deps
  // include token), but its playhead is owned by resumeAfterRefreshRef in
  // onLoadedMetadata — skip here when that restore is pending so we don't yank a
  // mid-playback viewer back toward the original resume point.
  useEffect(() => {
    if (resumeAfterRefreshRef.current != null) return;
    if (!token || !resumeSeconds || resumeSeconds <= 0) return;
    const el = videoRef.current;
    if (!el) return;
    const handler = () => {
      if ((el.currentTime ?? 0) < resumeSeconds) {
        el.currentTime = resumeSeconds;
      }
    };
    el.addEventListener("loadedmetadata", handler, { once: true });
    return () => el.removeEventListener("loadedmetadata", handler);
  }, [token, resumeSeconds]);

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
  }, [token]);

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
  }, [current.introStartSeconds, current.introEndSeconds, token]);

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
      />
    );
  }

  if (endState === "rateLimited") {
    return <RateLimitedNotice showSlug={showSlug} />;
  }

  if (endState === "unavailable") {
    return <PlaybackUnavailable showSlug={showSlug} onRetry={retry} />;
  }

  if (!token) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-black">
        <div className="flex items-center gap-3 text-white/60">
          <span className="size-2 animate-pulse rounded-full bg-[#ff3d3d]" />
          <span className="text-xs font-medium uppercase tracking-[0.3em]">
            {t.watch.loading}
          </span>
        </div>
      </div>
    );
  }

  return (
    <MediaController
      style={
        {
          display: "block",
          width: "100%",
          aspectRatio: supportsAspectRatio ? aspectRatio : undefined,
          ...(!supportsAspectRatio
            ? { position: "relative" as const, height: 0, paddingBottom: `${(1 / aspectRatio) * 100}%` }
            : {}),
          // Letterbox to fit the viewport whichever way the video is shaped:
          // vertical assets cap at `100vh * ratio` (narrow on landscape,
          // ~viewport-wide on portrait); horizontal assets cap by width.
          maxWidth: `min(100vw, calc(100vh * ${aspectRatio}))`,
          margin: "0 auto",
          backgroundColor: "#000",
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
        } as React.CSSProperties
      }
      className="group/player relative isolate"
    >
      <MuxVideo
        // Keyed on the token so a subscriber token refresh remounts the element
        // (the wrapper ignores tokens-only changes); playhead/play-state are
        // restored in onLoadedMetadata. Trial tokens never refresh, so this is
        // stable for the whole trial preview.
        key={token}
        ref={videoRef}
        slot="media"
        playbackId={current.playbackId}
        tokens={{ playback: token }}
        streamType="on-demand"
        // Without playsInline iOS Safari auto-promotes the video into its
        // system player on tap, drawing native chrome over ours. Setting
        // it keeps playback in the page so our custom controls own the
        // surface; the fullscreen button still hands off to the system
        // player on demand.
        playsInline
        // Autostart on landing for every mode (less funnel friction). Browsers
        // block autoplay-with-sound without a prior user gesture, so we start
        // muted and surface a tap-to-unmute pill; once the viewer unmutes, the
        // page has a user activation and later auto-advances keep sound.
        autoPlay
        muted={muted}
        // Buffer eagerly so playback starts fast and an auto-advance into a
        // prefetched-token episode has segments warming as early as possible.
        preload="auto"
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
            if (resumeAt > (v.currentTime ?? 0)) v.currentTime = resumeAt;
            if (wasPlayingRef.current) void v.play().catch(() => {});
          }
        }}
        onVolumeChange={(e) => {
          // Mirror the element's muted state up to the shell so the
          // tap-to-unmute pill reflects both our pill and media-chrome's mute
          // button, and so the choice persists across an auto-advance.
          onMutedChange(e.currentTarget.muted);
        }}
        onPlaying={() => {
          // Warm the next episode's token while this one plays so an
          // auto-advance starts without a /api/playback-token round-trip.
          // Skip trial (previews end at the paywall before the episode does)
          // and any next episode locked above this viewer's tier.
          if (next && mode !== "trial" && !isEpisodeLocked(next.tier, mode)) {
            prefetchToken(next.id);
          }
          // First real playback frame for this episode mount. Fires once even
          // across a token-refresh remount (the guard ref lives on the outer
          // component). No-op without marketing consent (PostHog not loaded).
          if (firstFrameFiredRef.current) return;
          firstFrameFiredRef.current = true;
          capturePostHog("first_frame", { show_slug: showSlug, mode });
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
            // Instant auto-advance: swap straight to the next episode with no
            // up-next countdown. The inner player remounts and consumes the
            // token prefetched while this episode played, so the transition is
            // near-instant. If next is locked above this viewer's tier the
            // same swap lands them on the right wall (and ?ep=<locked id> in
            // the URL resumes there after signup) — no token was prefetched
            // for it.
            onSwap(next.id);
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

      {/* Tap-to-unmute pill. Playback autostarts muted (browsers block
          autoplay-with-sound without a prior gesture), so this is the
          affordance to turn sound on. Stays visible even while the chrome is
          auto-hidden (no media-ui-inactive opacity), and hides once unmuted or
          when controls are locked. */}
      {muted && !locked ? (
        <button
          type="button"
          onClick={() => {
            const el = videoRef.current;
            if (el) {
              el.muted = false;
              // A muted autoplay can leave volume pinned at 0 on some
              // browsers — lift it so unmute is actually audible.
              if (el.volume === 0) el.volume = 1;
            }
            onMutedChange(false);
          }}
          aria-label={t.player.muteAria}
          className="absolute left-1/2 top-16 z-20 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-colors hover:bg-black/75 sm:top-20"
        >
          <Icon name="mute" size={16} />
          {t.player.tapToUnmute}
        </button>
      ) : null}

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
