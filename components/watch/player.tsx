"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import MuxVideo from "@mux/mux-video-react";
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
import { Icon } from "@/components/site/icon";
import { MatioLogo } from "@/components/site/matio-logo";
import { saveTrialPosition, saveWatchProgress } from "@/app/watch/actions";
import { Paywall } from "./paywall";
import { EpisodesOverlay } from "./episodes-overlay";
import { UpNextOverlay } from "./up-next-overlay";

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
};

type Mode = "subscriber" | "trial";

// Custom chrome built on media-chrome primitives over a headless mux-video.
// Owns the current-episode state so users can swap episodes (via the
// Episodes overlay or "Up Next" countdown) without leaving the page —
// the playback token is re-fetched per episode.
export function Player({
  episodes,
  initialEpisodeId,
  mode,
  showSlug,
  showTitle,
  resumeSeconds,
}: {
  episodes: PlayerEpisode[];
  initialEpisodeId: string;
  mode: Mode;
  showSlug: string;
  showTitle?: string;
  resumeSeconds?: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedRef = useRef<number>(0);

  // Currently playing episode — initial from server, then driven by overlay
  // selection / Up Next. resumeSecondsForCurrent only applies to the first
  // episode shown (server-side computed from query param + watch_progress).
  const [currentEpisodeId, setCurrentEpisodeId] = useState(initialEpisodeId);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [overlay, setOverlay] = useState<"none" | "episodes" | "upnext">(
    "none",
  );
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  // Lock state hides all chrome + makes it non-interactive so accidental
  // taps on a phone don't pause / seek / open overlays. A single tap on
  // the unlock pill restores the chrome.
  const [locked, setLocked] = useState(false);

  const current = useMemo(
    () =>
      episodes.find((e) => e.id === currentEpisodeId) ?? episodes[0],
    [episodes, currentEpisodeId],
  );
  const currentIdx = episodes.findIndex((e) => e.id === current.id);
  const next: PlayerEpisode | null =
    currentIdx >= 0 && currentIdx < episodes.length - 1
      ? episodes[currentIdx + 1]
      : null;
  const episodeLabel = `S${current.seasonNumber}·E${current.number}`;

  // Only honor server-provided resume on the initially loaded episode;
  // subsequent swaps start from 0 (or from media-chrome's own auto-recovery).
  const resumeForThisLoad =
    current.id === initialEpisodeId ? resumeSeconds : null;

  // Fetch playback token whenever the current episode changes.
  useEffect(() => {
    let cancelled = false;
    setToken(null);
    setExpiresAt(null);
    setPaywall(false);
    setShowSkipIntro(false);
    lastSavedRef.current = 0;
    fetch(
      `/api/playback-token?episode_id=${encodeURIComponent(current.id)}`,
      { cache: "no-store" },
    )
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setPaywall(true);
          return;
        }
        const data = (await r.json()) as {
          token: string;
          expiresIn: number;
        };
        setToken(data.token);
        setExpiresAt(Date.now() + data.expiresIn * 1000);
      })
      .catch(() => {
        if (cancelled) return;
        setPaywall(true);
      });
    return () => {
      cancelled = true;
    };
  }, [current.id]);

  // Token refresh on expiry. Subscribers get a fresh 1h token; trial users
  // who've used their time get 403 and the player flips to paywall.
  useEffect(() => {
    if (!expiresAt) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/playback-token?episode_id=${encodeURIComponent(current.id)}`,
          { cache: "no-store" },
        );
        if (r.ok) {
          const data = (await r.json()) as {
            token: string;
            expiresIn: number;
          };
          setToken(data.token);
          setExpiresAt(Date.now() + data.expiresIn * 1000);
          return;
        }
      } catch {
        // fall through to paywall
      }
      videoRef.current?.pause();
      setPaywall(true);
    }, ms);
    return () => clearTimeout(timer);
  }, [expiresAt, current.id]);

  // Save progress every 10s while playing.
  useEffect(() => {
    const interval = setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused) return;
      const t = Math.floor(el.currentTime ?? 0);
      if (t > 0 && t !== lastSavedRef.current) {
        lastSavedRef.current = t;
        const fn = mode === "trial" ? saveTrialPosition : saveWatchProgress;
        void fn(current.id, t, false).catch(() => {});
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [current.id, mode]);

  // Seek to resume position once the player has metadata for the initial
  // episode. Swaps reset to 0 by design.
  useEffect(() => {
    if (!token || !resumeForThisLoad || resumeForThisLoad <= 0) return;
    const el = videoRef.current;
    if (!el) return;
    const handler = () => {
      if ((el.currentTime ?? 0) < resumeForThisLoad) {
        el.currentTime = resumeForThisLoad;
      }
    };
    el.addEventListener("loadedmetadata", handler, { once: true });
    return () => el.removeEventListener("loadedmetadata", handler);
  }, [token, resumeForThisLoad]);

  // Skip-intro chip — visible while currentTime falls inside the episode's
  // intro window. Only activates when both markers are present (admin-set;
  // null on all episodes until the UI for it lands).
  useEffect(() => {
    const start = current.introStartSeconds;
    const end = current.introEndSeconds;
    if (start == null || end == null || end <= start) {
      setShowSkipIntro(false);
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      const t = el.currentTime ?? 0;
      setShowSkipIntro(t >= start && t < end);
    };
    update();
    el.addEventListener("timeupdate", update);
    return () => el.removeEventListener("timeupdate", update);
  }, [current.introStartSeconds, current.introEndSeconds, current.id, token]);

  // Swap to a different episode — updates state + URL, closes any open
  // overlay, and the effect chain handles fresh token + reset.
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
      // Resume position only applies to the initial render — strip it now
      // so a swap doesn't replay a stale offset.
      sp.delete("resume");
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [currentEpisodeId, pathname, router, searchParams],
  );

  if (paywall) {
    const lastPos = lastSavedRef.current;
    return (
      <Paywall
        showSlug={showSlug}
        resumeSeconds={lastPos || undefined}
        showTitle={showTitle}
        episodeLabel={episodeLabel}
      />
    );
  }

  if (!token) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-black">
        <div className="flex items-center gap-3 text-white/60">
          <span className="size-2 animate-pulse rounded-full bg-[#ff3d3d]" />
          <span className="text-xs font-medium uppercase tracking-[0.3em]">
            Loading
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
          aspectRatio: "16 / 9",
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
        } as React.CSSProperties
      }
      className="group/player relative isolate"
    >
      <MuxVideo
        ref={videoRef}
        slot="media"
        playbackId={current.playbackId}
        tokens={{ playback: token }}
        streamType="on-demand"
        metadata={{ video_id: current.id, video_title: current.title }}
        onError={() => setPaywall(true)}
        onEnded={() => {
          const el = videoRef.current;
          if (el) {
            const t = Math.floor(el.duration ?? 0);
            const fn =
              mode === "trial" ? saveTrialPosition : saveWatchProgress;
            void fn(current.id, t, true).catch(() => {});
          }
          if (next) setOverlay("upnext");
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
              aria-label="Back to show"
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
                available (Safari with a discoverable device only). */}
            <MediaAirplayButton
              className="!bg-transparent !p-0 text-current transition-colors hover:text-white"
              aria-label="Cast"
            >
              <span slot="icon" className="contents">
                <Icon name="cast" size={20} />
              </span>
            </MediaAirplayButton>
            {/* Captions button auto-hides when the stream has no text
                tracks (most uploaded Mux assets won't, until captions are
                generated or attached). */}
            <MediaCaptionsButton
              className="!bg-transparent !p-0 text-current transition-colors hover:text-white"
              aria-label="Toggle captions"
            >
              <span slot="icon" className="contents">
                <Icon name="subtitle" size={20} />
              </span>
            </MediaCaptionsButton>
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
            aria-label="Back 10 seconds"
          >
            <span slot="icon" className="contents">
              <Icon name="rewind" size={26} />
            </span>
            <span className="font-mono text-[9px] opacity-70">10s</span>
          </MediaSeekBackwardButton>
          <MediaPlayButton
            className="!flex h-[72px] w-[72px] items-center justify-center rounded-full border border-white/20 !bg-white/15 text-white backdrop-blur-xl transition-transform hover:scale-105"
            aria-label="Play/Pause"
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
            aria-label="Forward 10 seconds"
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
          Skip intro
        </button>
      ) : null}

      {/* Mini Matio branding */}
      <div
        className={`pointer-events-none absolute bottom-[88px] left-5 z-10 opacity-50 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:left-8 ${locked ? "!opacity-0" : ""}`}
      >
        <MatioLogo size={11} accent="#ff3d3d" color="#ffffff" />
      </div>

      {/* Bottom bar */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-5 pb-5 pt-4 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:px-8 ${locked ? "!opacity-0 !pointer-events-none" : ""}`}
      >
        <MediaTimeRange className="!block !h-3 !w-full !bg-transparent" />
        <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-white/85">
          <MediaTimeDisplay className="!bg-transparent !p-0 !text-white/85" />
          <MediaTimeDisplay
            remaining
            className="!bg-transparent !p-0 !text-white/55"
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-white/85">
          <div className="flex items-center gap-5">
            <MediaMuteButton
              className="!bg-transparent !p-0 text-current transition-colors hover:text-white"
              aria-label="Mute / unmute"
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
              aria-label="Lock controls"
              onClick={() => setLocked(true)}
              className="text-current transition-colors hover:text-white"
            >
              <Icon name="lock" size={18} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <MediaPlaybackRateButton
              rates={[0.5, 1, 1.25, 1.5, 2]}
              className="!rounded !bg-white/10 !px-2 !py-1 font-mono !text-[11px] !text-white transition-colors hover:!bg-white/15"
              aria-label="Playback speed"
            />
            <button
              type="button"
              onClick={() => setOverlay("episodes")}
              className="rounded bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15"
            >
              Episodes
            </button>
            {next ? (
              <button
                type="button"
                onClick={() => swap(next.id)}
                className="rounded bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15"
              >
                Up Next
              </button>
            ) : null}
            <MediaFullscreenButton
              className="!ml-1 !bg-transparent !p-0 text-current transition-colors hover:text-white"
              aria-label="Toggle fullscreen"
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

      {/* Unlock pill — only thing interactive when chrome is locked. */}
      {locked ? (
        <button
          type="button"
          onClick={() => setLocked(false)}
          className="absolute left-1/2 top-1/2 z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-xl transition-colors hover:bg-black/75"
          aria-label="Unlock controls"
        >
          <Icon name="lock" size={16} />
          Tap to unlock
        </button>
      ) : null}

      {/* Overlays */}
      {overlay === "episodes" ? (
        <EpisodesOverlay
          episodes={episodes}
          currentEpisodeId={current.id}
          showSlug={showSlug}
          onSelect={swap}
          onClose={() => setOverlay("none")}
        />
      ) : null}
      {overlay === "upnext" && next ? (
        <UpNextOverlay
          next={next}
          showSlug={showSlug}
          onPlayNow={() => swap(next.id)}
          onCancel={() => setOverlay("none")}
        />
      ) : null}
    </MediaController>
  );
}
