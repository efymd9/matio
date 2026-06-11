"use client";

import Link from "next/link";
import {
  MediaMuteButton,
  MediaPlayButton,
  MediaTimeDisplay,
  MediaTimeRange,
} from "media-chrome/react";
import { Icon } from "@/components/site/icon";
import { useT } from "@/lib/i18n/client";

// TikTok-style minimal chrome for vertical (portrait) shows on mobile. Rendered
// INSIDE the same <MediaController> as the standard chrome, so the media-chrome
// controls (play/mute/scrub) read the same controller state and the same
// underlying <video> element — none of the player's playback engine, token
// lifecycle, or element-identity invariants change. This is purely a different
// arrangement of controls: full-surface tap-to-play/pause, a slim progress
// bar, and just the essentials (back, title, sound). No seek clusters, rate,
// quality, fullscreen, or lock — "without unnecessary buttons".
//
// Layering: the full-surface play toggle sits at z-10; the top/bottom bars at
// z-20 (pointer-events only on their interactive children, so taps on empty
// gradient still pass through to toggle play); transient affordances (skip
// intro, unmute pill, tap-to-play, up-next chip) at z-30.
export function VerticalChrome({
  showSlug,
  showTitle,
  episodeTitle,
  episodeLabel,
  episodesCount,
  hasNext,
  showSkipIntro,
  showUnmutePill,
  needsTap,
  chipVisible,
  onOpenEpisodes,
  onUnmute,
  onTapPlay,
  onSkipIntro,
}: {
  showSlug: string;
  showTitle?: string;
  episodeTitle: string;
  episodeLabel: string;
  episodesCount: number;
  hasNext: boolean;
  showSkipIntro: boolean;
  showUnmutePill: boolean;
  needsTap: boolean;
  chipVisible: boolean;
  onOpenEpisodes: () => void;
  onUnmute: () => void;
  onTapPlay: () => void;
  onSkipIntro: () => void;
}) {
  const t = useT();

  return (
    <>
      {/* Full-surface tap target = play / pause. media-chrome swaps the slot
          by play-state, so the big glyph shows only while paused; the pause
          slot is empty so nothing overlays during playback. */}
      <MediaPlayButton
        className="!absolute !inset-0 !z-10 !flex !items-center !justify-center !bg-transparent !p-0"
        aria-label={t.player.playPauseAria}
      >
        <span slot="play" className="contents">
          <span className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-xl">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={36} />
            </span>
          </span>
        </span>
        <span slot="pause" className="contents" />
      </MediaPlayButton>

      {/* Top bar — back + title (left), sound toggle (right). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/25 to-transparent pb-14 pt-[max(env(safe-area-inset-top),1rem)] pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)]">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2.5">
          <Link
            href={`/shows/${showSlug}`}
            aria-label={t.player.backToShowAria}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/70"
          >
            <Icon name="back" size={18} />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] leading-none text-white/70">
              {episodeLabel}
            </p>
            <h1 className="mt-0.5 truncate text-sm font-bold leading-tight text-white">
              {showTitle ? `${showTitle} — ${episodeTitle}` : episodeTitle}
            </h1>
          </div>
        </div>
        <MediaMuteButton
          className="pointer-events-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full !bg-black/45 text-white backdrop-blur-md transition-colors hover:!bg-black/70"
          aria-label={t.player.muteAria}
        >
          <span slot="high" className="contents">
            <Icon name="volume" size={18} />
          </span>
          <span slot="medium" className="contents">
            <Icon name="volume" size={18} />
          </span>
          <span slot="low" className="contents">
            <Icon name="volume" size={18} />
          </span>
          <span slot="off" className="contents">
            <Icon name="mute" size={18} />
          </span>
        </MediaMuteButton>
      </div>

      {/* Skip-intro chip — only inside the admin-set intro window. */}
      {showSkipIntro ? (
        <button
          type="button"
          onClick={onSkipIntro}
          className="absolute bottom-28 right-4 z-30 rounded-md border border-white/25 bg-black/55 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-xl transition-colors hover:bg-black/75"
        >
          {t.player.skipIntro}
        </button>
      ) : null}

      {/* "Tap for sound" pill — autoplay landed in the muted fallback. Routes
          through media-chrome's request pipeline (so the persisted mute pref
          updates too), then the parent hides the pill + clears muted. */}
      {showUnmutePill ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.currentTarget.dispatchEvent(
              new CustomEvent("mediaunmuterequest", {
                composed: true,
                bubbles: true,
              }),
            );
            onUnmute();
          }}
          className="absolute bottom-28 left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/25 bg-black/65 px-4 py-2 text-xs font-semibold text-white backdrop-blur-xl transition-colors hover:bg-black/80"
        >
          <Icon name="mute" size={14} />
          {t.player.tapForSound}
        </button>
      ) : null}

      {/* Transient "Up next" chip right after an auto-advance. */}
      {chipVisible ? (
        <div className="pointer-events-none absolute left-1/2 top-[max(env(safe-area-inset-top),1rem)] z-30 max-w-[78%] -translate-x-1/2 truncate rounded-full border border-white/15 bg-black/65 px-4 py-2 text-xs font-semibold text-white backdrop-blur-xl">
          {t.player.upNextBtn} · {episodeLabel} — {episodeTitle}
        </div>
      ) : null}

      {/* Tap-to-play — autoplay fully blocked (e.g. iOS Low Power Mode); the
          element is left paused with no signal, so this is our own affordance.
          The tap also blesses the element for unmuted auto-advance later. */}
      {needsTap ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTapPlay();
          }}
          aria-label={t.player.playPauseAria}
          className="absolute inset-0 z-30 flex items-center justify-center"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur-xl">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={36} />
            </span>
          </span>
        </button>
      ) : null}

      {/* Bottom bar — slim progress + time, optional episodes button. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent pt-12 pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
        <div className="pointer-events-auto">
          <MediaTimeRange className="!block !h-3 !w-full !bg-transparent" />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-white/85">
              <MediaTimeDisplay className="!bg-transparent !p-0 !text-white/85" />
              <span className="text-white/30">/</span>
              <MediaTimeDisplay
                remaining
                className="!bg-transparent !p-0 !text-white/55"
              />
            </div>
            {episodesCount > 1 || hasNext ? (
              <button
                type="button"
                onClick={onOpenEpisodes}
                className="rounded-full bg-white/12 px-3.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
              >
                {t.player.episodesBtn}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
