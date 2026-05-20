"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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

  useEffect(() => {
    if (remaining <= 0) {
      onPlayNow();
      return;
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onPlayNow]);

  if (!mounted) return null;

  const pct =
    ((COUNTDOWN_SECONDS - remaining) / COUNTDOWN_SECONDS) * 100;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-end justify-end p-5 sm:p-8">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f12]/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          {t.upNextOverlay.label}
        </p>
        <div className="mt-3 flex gap-3">
          <div
            className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md sm:w-40"
            style={
              next.thumbnailUrl
                ? undefined
                : { backgroundImage: TONE_GRADIENT[tone] }
            }
          >
            {next.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={next.thumbnailUrl}
                alt=""
                aria-hidden
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div
                className="absolute inset-0 opacity-30"
                aria-hidden
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25), transparent 60%)",
                }}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-md">
                <Icon name="play" size={14} color="#ffffff" />
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] text-white/65">
              S{next.seasonNumber}·E{next.number}
            </p>
            <h3 className="mt-0.5 truncate text-base font-bold text-white">
              {next.title}
            </h3>
            {next.description ? (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/55">
                {next.description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-[#ff3d3d] transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayNow();
            }}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-white text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="play" size={14} color="#0a0a0c" />
            {t.upNextOverlay.watchNow}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            {t.upNextOverlay.cancel}
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-white/45">
          {t.upNextOverlay.playingIn(remaining)}
        </p>
      </div>
    </div>,
    document.body,
  );
}
