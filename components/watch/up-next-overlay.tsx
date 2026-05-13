"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import type { PlayerEpisode } from "./player";

const COUNTDOWN_SECONDS = 7;

// Shown when an episode ends and a next one exists. A 7-second countdown
// auto-advances to the next episode unless the user cancels. "Watch now"
// skips the countdown.
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
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const tone = toneFor(showSlug);

  useEffect(() => {
    if (remaining <= 0) {
      onPlayNow();
      return;
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onPlayNow]);

  const pct =
    ((COUNTDOWN_SECONDS - remaining) / COUNTDOWN_SECONDS) * 100;

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-end bg-gradient-to-t from-black via-black/80 to-black/40 p-5 sm:p-8">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f0f12]/95 p-4 backdrop-blur-2xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          Up next
        </p>
        <div className="mt-3 flex gap-3">
          <div
            className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md sm:w-40"
            style={{ backgroundImage: TONE_GRADIENT[tone] }}
          >
            <div
              className="absolute inset-0 opacity-30"
              aria-hidden
              style={{
                backgroundImage:
                  "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25), transparent 60%)",
              }}
            />
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

        {/* Countdown progress bar */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full bg-[#ff3d3d] transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onPlayNow}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-white text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="play" size={14} color="#0a0a0c" />
            Watch now
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center justify-center rounded-md border border-white/15 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] text-white/45">
          Playing in {remaining}s
        </p>
      </div>
    </div>
  );
}
