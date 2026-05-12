"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const IDLE_MS = 3000;

export function WatchShell({
  showTitle,
  episodeTitle,
  showSlug,
  children,
}: {
  showTitle: string;
  episodeTitle: string;
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
        // hide the OS cursor when overlay is auto-hidden — only over the
        // player area where it'd interfere with the cinematic vibe.
        visible ? "cursor-auto" : "cursor-none",
      )}
    >
      <header
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 via-black/35 to-transparent px-6 pb-14 pt-5 transition-opacity duration-500 sm:px-10",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto flex items-center gap-4">
          <Link
            href={`/shows/${showSlug}`}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-base text-white backdrop-blur-md transition-colors hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            aria-label="Back to show"
          >
            ←
          </Link>
          <div className="min-w-0 space-y-0.5">
            <p className="text-[10px] uppercase tracking-[0.35em] text-white/60">
              {showTitle}
            </p>
            <h1 className="truncate font-display text-xl italic leading-tight text-white sm:text-2xl">
              {episodeTitle}
            </h1>
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
