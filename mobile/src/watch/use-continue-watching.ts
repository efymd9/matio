import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { ContinueWatchingEntry } from "@/shared/api-types";
import { onProgressSaved } from "./use-progress-saver";

// The continue-watching data — the Home rail and the Account tab's full list
// share it. Signed-in only (the endpoint is 401 otherwise, and there is
// nothing to resume for an anonymous viewer yet). Refreshed on focus when a
// save has landed since the last load — the player announces saves through
// onProgressSaved — so coming back from an episode shows the position just
// watched, not the one from last time. While the player is open (the screen
// unfocused) saves only mark the list dirty: no network per tick for a screen
// nobody is looking at.
export function useContinueWatching(signedIn: boolean): ContinueWatchingEntry[] {
  const [items, setItems] = useState<ContinueWatchingEntry[]>([]);
  const focused = useRef(false);
  const dirty = useRef(true);

  const load = useCallback(() => {
    dirty.current = false;
    api
      .continueWatching()
      .then((res) => setItems(res.items))
      .catch(() => {
        // Best-effort: the list simply keeps what it had.
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (!signedIn) {
        setItems([]);
        dirty.current = true;
      } else if (dirty.current) {
        load();
      }
      return () => {
        focused.current = false;
      };
    }, [signedIn, load]),
  );

  useEffect(
    () =>
      onProgressSaved(() => {
        if (focused.current && signedIn) load();
        else dirty.current = true;
      }),
    [signedIn, load],
  );

  return items;
}
