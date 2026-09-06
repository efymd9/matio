import { useCallback, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { api } from "@/api/client";

// Watch-progress saves, ported from the web player by intent rather than by
// letter — React Native has no visibilitychange / pagehide:
//
//   - the playhead is sampled from the player's onProgress into a ref; no
//     state, no re-render, no network on the tick itself
//   - every 10s, while PLAYING and only if the position moved, one save.
//     "Playing" is read from the progress stream itself — a sample within
//     the last few seconds — rather than from a play-state callback, so a
//     platform that never fires one cannot silently stop every save; a
//     paused player produces no samples, and an unchanged position is
//     deduped anyway
//   - AppState → background / inactive flushes at once (the phone-lock case
//     that cost web users up to 10s of progress before the visibility gate)
//   - unmount flushes (back navigation)
//   - `ended` saves once with completed=true, and nothing else is saved for
//     the episode until the playhead moves back (a replay), matching the
//     web's "an ended element was already final-saved" rule
//
// Signed-out viewers save nothing: POST /v1/progress is 401 for them, and a
// request that is known to be refused is battery, not measurement.
export const PROGRESS_SAVE_INTERVAL_MS = 10_000;

// A progress sample older than this means the player is paused, buffering
// or gone — nothing to save. Comfortably above the 1s sampling interval the
// player is configured with.
const PLAYING_WINDOW_MS = 3_000;

// Home learns that a save landed through this, so the continue-watching rail
// refreshes after a watch instead of showing the position from last time. A
// module-level signal rather than a store: one producer, one consumer.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onProgressSaved(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useProgressSaver(episodeId: string, enabled: boolean) {
  const state = useRef({ position: 0, sampledAt: 0, lastSaved: -1, ended: false });

  const save = useCallback(
    (completed: boolean) => {
      if (!enabled) return;
      const s = state.current;
      const t = Math.floor(s.position);
      if (completed) {
        s.ended = true;
      } else {
        if (s.ended) return;
        if (t <= 0 || t === s.lastSaved) return;
      }
      s.lastSaved = t;
      void api
        .saveProgress({ episodeId, positionSeconds: t, completed })
        .then(() => {
          for (const listener of listeners) listener();
        })
        .catch(() => {
          // Best-effort: the next tick retries with a fresher position.
        });
    },
    [enabled, episodeId],
  );

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => {
      const s = state.current;
      if (s.ended || Date.now() - s.sampledAt > PLAYING_WINDOW_MS) return;
      save(false);
    }, PROGRESS_SAVE_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") save(false);
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
      save(false);
    };
  }, [enabled, save]);

  return useMemo(
    () => ({
      onProgress(currentTime: number) {
        const s = state.current;
        // A playhead that jumped backwards after `ended` is a replay or a
        // seek — the episode is live again and may be saved again.
        if (s.ended && currentTime + 1 < s.position) s.ended = false;
        s.position = currentTime;
        s.sampledAt = Date.now();
      },
      onEnded() {
        save(true);
      },
    }),
    [save],
  );
}
