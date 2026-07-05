"use client";

import Link from "next/link";
import {
  MediaCaptionsButton,
  MediaMuteButton,
  MediaPlayButton,
  MediaTimeDisplay,
  MediaTimeRange,
} from "media-chrome/react";
import { Icon } from "@/components/site/icon";
import { useT } from "@/lib/i18n/client";

// "M:SS" — the static total-duration read-out on the right of the progress
// row. The elapsed side is a live <MediaTimeDisplay>; the duration is known
// server-side so we format it here rather than pulling a second media element.
function formatTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// TikTok-style minimal chrome for vertical (portrait) shows on mobile. Rendered
// INSIDE the same <MediaController> as the standard chrome, so the media-chrome
// controls (play/mute/scrub) read the same controller state and the same
// underlying <video> element — none of the player's playback engine, token
// lifecycle, or element-identity invariants change. This is purely a different
// arrangement of controls: full-surface tap-to-play/pause, a bottom-left
// title/progress block, and a right rail of essentials.
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
  episodeNumber,
  durationSeconds,
  episodesCount,
  hasNext,
  hasCaptions,
  locked,
  showSkipIntro,
  showUnmutePill,
  needsTap,
  chipVisible,
  onOpenEpisodes,
  onLock,
  onUnlock,
  onUnmute,
  onTapPlay,
  onSkipIntro,
}: {
  showSlug: string;
  showTitle?: string;
  episodeTitle: string;
  episodeLabel: string;
  episodeNumber: number;
  durationSeconds: number | null;
  episodesCount: number;
  hasNext: boolean;
  hasCaptions: boolean;
  locked: boolean;
  showSkipIntro: boolean;
  showUnmutePill: boolean;
  needsTap: boolean;
  chipVisible: boolean;
  onOpenEpisodes: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onUnmute: () => void;
  onTapPlay: () => void;
  onSkipIntro: () => void;
}) {
  const t = useT();

  // Web Share with a clipboard fallback; a user-cancelled share dialog throws
  // AbortError which we swallow.
  const onShare = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: showTitle ?? episodeTitle, url });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
    }
  };

  // Locked: hide the whole TikTok layout (including the full-surface play
  // toggle) and surface a single unlock pill — matching the standard chrome's
  // lock behavior.
  if (locked) {
    return (
      <button
        type="button"
        onClick={onUnlock}
        aria-label={t.player.unlockAria}
        className="absolute left-1/2 top-1/2 z-30 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-rust/60 bg-burgundy/50 px-4 py-2.5 text-sm font-semibold text-cream backdrop-blur-xl transition-colors hover:bg-burgundy/70"
      >
        <Icon name="lock" size={16} />
        {t.player.tapToUnlock}
      </button>
    );
  }

  const minutes = durationSeconds ? Math.floor(durationSeconds / 60) : null;

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
          <span className="bg-gold-cta flex h-20 w-20 items-center justify-center rounded-full text-gold-deep shadow-[0_20px_50px_-16px_rgba(230,179,102,0.6)]">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={36} color="#241205" />
            </span>
          </span>
        </span>
        <span slot="pause" className="contents" />
      </MediaPlayButton>

      {/* Top bar — back (left), lock (right). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 via-black/25 to-transparent pb-14 pt-[max(env(safe-area-inset-top),1rem)] pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)]">
        <Link
          href={`/shows/${showSlug}`}
          aria-label={t.player.backToShowAria}
          className="pointer-events-auto inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-rust/60 bg-burgundy/50 text-cream backdrop-blur-xl transition-colors hover:bg-burgundy/70"
        >
          <Icon name="back" size={17} />
        </Link>
        <button
          type="button"
          onClick={onLock}
          aria-label={t.player.lockAria}
          className="pointer-events-auto inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-black/40 text-cream backdrop-blur-xl transition-colors hover:bg-black/60"
        >
          <Icon name="lock" size={16} />
        </button>
      </div>

      {/* "Tap for sound" pill — autoplay landed in the muted fallback. Routes
          through media-chrome's request pipeline (so the persisted mute pref
          updates too), then the parent hides the pill + clears muted. Centered
          just under the top bar. */}
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
          className="absolute left-1/2 top-[calc(max(env(safe-area-inset-top),1rem)+3.25rem)] z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-xs font-bold text-cream backdrop-blur-xl transition-colors hover:bg-black/70"
        >
          <Icon name="mute" size={14} color="#e6b366" />
          {t.player.tapForSound}
        </button>
      ) : null}

      {/* Skip-intro chip — only inside the admin-set intro window. */}
      {showSkipIntro ? (
        <button
          type="button"
          onClick={onSkipIntro}
          className="bg-gold-cta absolute bottom-40 right-4 z-30 inline-flex h-[38px] items-center rounded-full px-5 text-[13px] font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          {t.player.skipIntro}
        </button>
      ) : null}

      {/* Transient "Up next" chip right after an auto-advance. */}
      {chipVisible ? (
        <div className="pointer-events-none absolute left-1/2 top-[max(env(safe-area-inset-top),1rem)] z-30 max-w-[78%] -translate-x-1/2 truncate rounded-full border border-rust/30 bg-black/65 px-4 py-2 text-xs font-semibold text-cream backdrop-blur-xl">
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
          <span className="bg-gold-cta flex h-20 w-20 items-center justify-center rounded-full text-gold-deep shadow-[0_20px_50px_-16px_rgba(230,179,102,0.6)]">
            <span className="-mr-1 inline-flex">
              <Icon name="play" size={36} color="#241205" />
            </span>
          </span>
        </button>
      ) : null}

      {/* Bottom block — title/meta/progress (left) + control rail (right). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-3.5 bg-gradient-to-t from-black/85 via-black/30 to-transparent pt-16 pl-[max(env(safe-area-inset-left),1.125rem)] pr-[max(env(safe-area-inset-right),1.125rem)] pb-[max(env(safe-area-inset-bottom),1.125rem)]">
        <div className="pointer-events-auto min-w-0 flex-1 pb-0.5">
          <div className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.2em] text-gold">
            <span className="inline-block h-0.5 w-3 rounded-[1px] bg-rust" />
            <span>{t.hero.matioOriginal}</span>
          </div>
          <p className="mt-2 truncate font-display text-[22px] uppercase leading-none tracking-[0.02em] text-cream">
            {showTitle ?? episodeTitle}
          </p>
          <p className="mt-1.5 truncate text-xs font-semibold text-cream/65">
            {t.home.epShort(episodeNumber)} · {episodeTitle}
            {minutes ? ` · ${t.episodesOverlay.minutes(minutes)}` : ""}
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            <MediaTimeRange className="!block !h-2.5 !w-full !bg-transparent" />
            <div className="flex justify-between font-mono text-[10px] font-semibold tabular-nums text-cream/60">
              <MediaTimeDisplay className="!bg-transparent !p-0 !text-cream/60" />
              <span>{durationSeconds ? formatTime(durationSeconds) : ""}</span>
            </div>
          </div>
        </div>
        {/* Rail floats a fixed 34px above the block's baseline (9b spec) —
            the parent already absorbs the safe-area inset. */}
        <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-3 pb-[34px]">
          <MediaMuteButton
            className="inline-flex h-11 w-11 items-center justify-center rounded-full !bg-black/45 !p-0 text-cream backdrop-blur-xl transition-colors hover:!bg-black/60"
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
          {hasCaptions ? (
            <MediaCaptionsButton
              className="inline-flex h-11 w-11 items-center justify-center rounded-full !bg-black/45 !p-0 text-cream backdrop-blur-xl transition-colors hover:!bg-black/60"
              aria-label={t.player.captionsAria}
            >
              <span slot="icon" className="contents">
                <Icon name="subtitle" size={18} />
              </span>
            </MediaCaptionsButton>
          ) : null}
          <button
            type="button"
            onClick={onShare}
            aria-label={t.player.shareAria}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-cream backdrop-blur-xl transition-colors hover:bg-black/60"
          >
            <Icon name="share" size={18} />
          </button>
          {episodesCount > 1 || hasNext ? (
            <button
              type="button"
              onClick={onOpenEpisodes}
              aria-label={t.player.episodesBtn}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-burgundy/80 text-cream backdrop-blur-xl transition-colors hover:bg-burgundy"
            >
              <Icon name="menu" size={18} />
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
