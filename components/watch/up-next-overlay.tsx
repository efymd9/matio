"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

// SSR-safe "are we on the client" flag without setState-in-effect.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { useT } from "@/lib/i18n/client";
import type { PlayerEpisode } from "./player";

const COUNTDOWN_SECONDS = 7;

// Up-next card. Portaled out of the MediaController tree so its buttons
// aren't intercepted by media-chrome's click-to-toggle-play behavior.
export function UpNextOverlay({
  next,
  showSlug,
  onPlayNow,
  onCancel,
}: {
  next: PlayerEpisode;
  showSlug: string;
  onPlayNow: () => void;
  onCancel: () => void;
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const tone = toneFor(showSlug);
  const t = useT();
  const playRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    playRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  useEffect(() => {
    if (remaining <= 0) {
      onPlayNow();
      return;
    }
    const timer = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [remaining, onPlayNow]);

  if (!mounted) return null;

  const pct =
    ((COUNTDOWN_SECONDS - remaining) / COUNTDOWN_SECONDS) * 100;

  return createPortal(
    // Side/bottom padding honors iOS landscape notch + home-indicator
    // safe-area; pt-/pl- keep the original p-5/p-8 cushion.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.upNextOverlay.label}
      className="pointer-events-none fixed inset-0 z-[100] flex items-end justify-end pt-5 pl-5 pr-[max(env(safe-area-inset-right),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:pt-8 sm:pl-8 sm:pr-[max(env(safe-area-inset-right),2rem)] sm:pb-[max(env(safe-area-inset-bottom),2rem)]"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-rust/30 bg-espresso-2/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {t.upNextOverlay.label}
        </p>
        <div className="mt-3 flex gap-3">
          <div
            className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-[14px] sm:w-40"
            style={
              next.thumbnailUrl
                ? undefined
                : { backgroundImage: TONE_GRADIENT[tone] }
            }
          >
            {next.thumbnailUrl ? (
              <Image
                src={next.thumbnailUrl}
                alt=""
                aria-hidden
                fill
                sizes="(max-width: 640px) 128px, 160px"
                className="object-cover"
              />
            ) : (
              <div
                className="absolute inset-0 opacity-30"
                aria-hidden
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 50% 50%, rgba(230,179,102,0.25), transparent 60%)",
                }}
              />
            )}
            <div
              aria-hidden
              className="duotone pointer-events-none absolute inset-0"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-burgundy/80 text-cream backdrop-blur-md">
                <Icon name="play" size={14} color="#f6efe4" />
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] text-cream/65">
              S{next.seasonNumber}·E{next.number}
            </p>
            <h3 className="mt-0.5 truncate text-base font-bold text-cream">
              {next.title}
            </h3>
            {next.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-cream/55">
                {next.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-cream/15">
          <div
            className="h-full bg-gold transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            ref={playRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayNow();
            }}
            className="bg-gold-cta inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            <Icon name="play" size={14} color="#241205" />
            {t.upNextOverlay.watchNow}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="inline-flex h-11 items-center justify-center rounded-full border border-cream/20 px-4 text-sm font-semibold text-cream transition-colors hover:bg-cream/10"
          >
            {t.upNextOverlay.cancel}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-cream/45" aria-live="polite" aria-atomic="true">
          {t.upNextOverlay.playingIn(remaining)}
        </p>
      </div>
    </div>,
    document.body,
  );
}
