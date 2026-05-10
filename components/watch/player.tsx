"use client";

import MuxPlayer from "@mux/mux-player-react";
import { useEffect, useRef, type ComponentRef } from "react";
import { saveWatchProgress } from "@/app/watch/actions";

export function Player({
  episodeId,
  playbackId,
  title,
}: {
  episodeId: string;
  playbackId: string;
  title: string;
}) {
  const ref = useRef<ComponentRef<typeof MuxPlayer>>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const el = ref.current;
      if (!el || el.paused) return;
      const t = Math.floor(el.currentTime ?? 0);
      if (t > 0) {
        // Fire and forget — don't await to avoid backing up timer.
        void saveWatchProgress(episodeId, t, false).catch(() => {});
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [episodeId]);

  return (
    <MuxPlayer
      ref={ref}
      playbackId={playbackId}
      streamType="on-demand"
      metadata={{ video_id: episodeId, video_title: title }}
      onEnded={() => {
        const el = ref.current;
        if (!el) return;
        const t = Math.floor(el.duration ?? 0);
        void saveWatchProgress(episodeId, t, true).catch(() => {});
      }}
      style={{ width: "100%", aspectRatio: "16 / 9" }}
    />
  );
}
