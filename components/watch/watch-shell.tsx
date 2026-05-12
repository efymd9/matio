"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/site/icon";

const IDLE_MS = 3000;

export function WatchShell({
  showTitle,
  episodeTitle,
  episodeLabel,
  showSlug,
  children,
}: {
  showTitle: string;
  episodeTitle: string;
  episodeLabel?: string;
  showSlug: string;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const reset = () => {
      setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), IDLE_MS);
    };
    reset();
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
    ];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col bg-black",
        visible ? "cursor-auto" : "cursor-none",
      )}
    >
      <header
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/85 via-black/40 to-transparent px-5 pb-16 pt-5 transition-opacity duration-500 sm:px-10",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
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
                {showTitle} — {episodeTitle}
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
      </header>

      {/* Player stage — letterboxes to viewport while preserving 16:9. */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[calc(100vh*16/9)]">{children}</div>
      </div>
    </div>
  );
}
