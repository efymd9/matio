"use client";

import { useEffect, useRef, useState } from "react";
import MuxVideo from "@mux/mux-video-react";
import {
  MediaController,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeRange,
  MediaTimeDisplay,
  MediaMuteButton,
  MediaPlaybackRateButton,
  MediaFullscreenButton,
} from "media-chrome/react";
import Link from "next/link";
import { Icon } from "@/components/site/icon";
import { MatioLogo } from "@/components/site/matio-logo";
import { saveTrialPosition, saveWatchProgress } from "@/app/watch/actions";
import { Paywall } from "./paywall";

type Mode = "subscriber" | "trial";

// Custom chrome built on media-chrome primitives, sitting over a headless
// <mux-video>. Mux's HLS/ABR/signed-JWT/Mux Data pipeline is untouched — we
// only replace the visual layer.
//
// Chrome visibility is driven by media-chrome's own idle detection: when the
// controller adds the `media-ui-inactive` attribute (during steady playback
// with no input), Tailwind's `group-[[media-ui-inactive]]:` rules fade the
// overlay layers to 0. Pausing or moving the pointer brings them back.
export function Player({
  episodeId,
  playbackId,
  title,
  mode,
  showSlug,
  showTitle,
  episodeLabel,
  resumeSeconds,
}: {
  episodeId: string;
  playbackId: string;
  title: string;
  mode: Mode;
  showSlug: string;
  showTitle?: string;
  episodeLabel?: string;
  resumeSeconds?: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [paywall, setPaywall] = useState(false);
  const lastSavedRef = useRef<number>(0);

  // Fetch playback token on mount / when episode changes.
  useEffect(() => {
    let cancelled = false;
    setToken(null);
    setExpiresAt(null);
    setPaywall(false);
    fetch(
      `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
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
  }, [episodeId]);

  // When the token expires, refresh — subscribers get a new 1h token and
  // keep playing; trial users get 403 → paywall. This stops a buffered-ahead
  // stream from running past the trial cut-off until the next page reload.
  useEffect(() => {
    if (!expiresAt) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0) return;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/playback-token?episode_id=${encodeURIComponent(episodeId)}`,
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
  }, [expiresAt, episodeId]);

  // Save position every 10s while playing.
  useEffect(() => {
    const interval = setInterval(() => {
      const el = videoRef.current;
      if (!el || el.paused) return;
      const t = Math.floor(el.currentTime ?? 0);
      if (t > 0 && t !== lastSavedRef.current) {
        lastSavedRef.current = t;
        const fn = mode === "trial" ? saveTrialPosition : saveWatchProgress;
        void fn(episodeId, t, false).catch(() => {});
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [episodeId, mode]);

  // Seek to resume position once the player has metadata.
  useEffect(() => {
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

  if (paywall) {
    const lastPos = lastSavedRef.current;
    return (
      <Paywall
        showSlug={showSlug}
        resumeSeconds={lastPos || resumeSeconds || undefined}
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
      // CSS variables consumed by media-chrome's built-in primitives
      // (range bar, time display, focus rings). Defined once at the
      // controller level so every child inherits the cinema-red treatment.
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
        playbackId={playbackId}
        tokens={{ playback: token }}
        streamType="on-demand"
        metadata={{ video_id: episodeId, video_title: title }}
        onError={() => setPaywall(true)}
        onEnded={() => {
          const el = videoRef.current;
          if (!el) return;
          const t = Math.floor(el.duration ?? 0);
          const fn = mode === "trial" ? saveTrialPosition : saveWatchProgress;
          void fn(episodeId, t, true).catch(() => {});
        }}
        className="h-full w-full"
      />

      {/* Top scrim — back button, episode label, top-right control row.
          Fades out together with the rest of the chrome on idle. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-5 pb-14 pt-5 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:px-8">
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
              {episodeLabel ? (
                <p className="font-mono text-[11px] leading-none text-white/70">
                  {episodeLabel}
                </p>
              ) : null}
              <h1 className="mt-0.5 truncate text-base font-bold leading-tight text-white sm:text-lg">
                {showTitle ? `${showTitle} — ${title}` : title}
              </h1>
            </div>
          </div>
          <div className="hidden items-center gap-5 text-white/85 sm:flex">
            <button
              type="button"
              aria-label="Cast"
              className="transition-colors hover:text-white"
            >
              <Icon name="cast" size={20} />
            </button>
            <button
              type="button"
              aria-label="Subtitles"
              className="transition-colors hover:text-white"
            >
              <Icon name="subtitle" size={20} />
            </button>
            <button
              type="button"
              aria-label="Settings"
              className="transition-colors hover:text-white"
            >
              <Icon name="settings" size={20} />
            </button>
          </div>
        </div>
      </div>

      {/* Center cluster — rewind 10s / play-pause / forward 10s */}
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0">
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

      {/* Mini Matio branding — bottom-left, sits above the bottom bar */}
      <div className="pointer-events-none absolute bottom-[88px] left-5 z-10 opacity-50 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:left-8">
        <MatioLogo size={11} accent="#ff3d3d" color="#ffffff" />
      </div>

      {/* Bottom bar — progress, time, secondary controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-5 pb-5 pt-4 transition-opacity duration-300 group-[[media-ui-inactive]]/player:opacity-0 sm:px-8">
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
              className="rounded bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15"
            >
              Episodes
            </button>
            <button
              type="button"
              className="rounded bg-white/10 px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-white/15"
            >
              Up Next
            </button>
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
    </MediaController>
  );
}
