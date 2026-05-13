"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const IDLE_MS = 3000;

// Thin fullscreen layout wrapper for the player. All chrome (back, episode
// label, controls, branding) is now rendered by the Player itself so the
// idle-fade is driven by media-chrome's own state, not a sibling timer.
// This component only owns:
//   1. the black fullscreen canvas
//   2. letterboxing the player to 16:9
//   3. cursor auto-hide on idle for a more cinematic feel
export function WatchShell({
  children,
}: {
  // Kept in the type signature so the watch route can keep passing the same
  // props without changes. They flow through to Player which renders the top
  // chrome inline now.
  showTitle?: string;
  episodeTitle?: string;
  episodeLabel?: string;
  showSlug?: string;
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
        "fixed inset-0 z-50 flex items-center justify-center bg-black",
        visible ? "cursor-auto" : "cursor-none",
      )}
    >
      <div className="w-full max-w-[calc(100vh*16/9)]">{children}</div>
    </div>
  );
}
