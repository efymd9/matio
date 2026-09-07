import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import {
  WATCH_SEGMENT_BUCKET_SECONDS,
  WATCH_SEGMENT_FLUSH_MAX_BUCKETS,
} from "@/shared/api-types";
import { enqueueWatchSegments } from "./segment-queue";

// Audience-retention bucket tracking, ported from the web player
// (components/watch/player.tsx) by semantics rather than by letter:
//
//   - every progress sample marks the 10s bucket the playhead is in;
//     continuous playback marks a bucket ONCE (lastMarked)
//   - a seek re-arms lastMarked, so re-crossing a bucket counts again —
//     that re-count is the rewatch peak on the admin retention curve, not
//     a bug
//   - the accumulated set is flushed every 20s, when it reaches the
//     per-flush cap, at `ended`, on AppState → background/inactive, and on
//     unmount — into the offline queue, never straight to the network
//
// One hook instance per episode: the feed keys each item on its episode id,
// so a set can never carry over from one episode to the next.
export const SEGMENT_FLUSH_INTERVAL_MS = 20_000;

export function useSegmentTracker(episodeId: string, enabled: boolean) {
  const state = useRef({ pending: new Set<number>(), lastMarked: null as number | null });

  const flush = useCallback(() => {
    const s = state.current;
    if (s.pending.size === 0) return;
    const buckets = [...s.pending];
    s.pending.clear();
    enqueueWatchSegments(episodeId, buckets);
  }, [episodeId]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(flush, SEGMENT_FLUSH_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") flush();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
      flush();
    };
  }, [enabled, flush]);

  return useMemo(
    () => ({
      onProgress(currentTime: number) {
        if (!enabled) return;
        const bucket = Math.floor(Math.max(0, currentTime) / WATCH_SEGMENT_BUCKET_SECONDS);
        const s = state.current;
        if (bucket === s.lastMarked) return;
        s.pending.add(bucket);
        s.lastMarked = bucket;
        if (s.pending.size >= WATCH_SEGMENT_FLUSH_MAX_BUCKETS) flush();
      },
      onSeek() {
        state.current.lastMarked = null;
      },
      onEnded() {
        flush();
      },
    }),
    [enabled, flush],
  );
}
