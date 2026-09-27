import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { api } from "@/api/client";
import type { ContinueWatchingEntry } from "@/shared/api-types";
import { onProgressSaved } from "./use-progress-saver";

const NONE: ContinueWatchingEntry[] = [];

// The continue-watching data — the Home rail and the Account tab's full list
// share it. Signed-in only (the endpoint is 401 otherwise, and there is
// nothing to resume for an anonymous viewer yet). Refreshed on focus when a
// save has landed since the last load — the player announces saves through
// onProgressSaved — so coming back from an episode shows the position just
// watched, not the one from last time. While the player is open (the screen
// unfocused) saves only mark the list dirty: no network per tick for a screen
// nobody is looking at.
//
// Three more things mark it dirty, because the app stays in memory for days:
// a failed load (the next focus retries it — a first load that met bad
// cellular or a Bearer-less 401 used to leave the list empty for the whole
// session), a return to the foreground (progress watched on the web or another
// device), and a change of account. Every load is numbered, and only the
// newest may write: an older answer can neither overwrite a newer one nor
// repopulate the list after a sign-out.
//
// `reload` is Home's pull-to-refresh (#313): the same load, asked for now,
// and a promise that settles with it — never rejects, so a failure keeps the
// list on screen and marks it dirty exactly as above. Signed out there is
// nothing to ask for, and it resolves at once without a request.
export function useContinueWatching(signedIn: boolean): {
  items: ContinueWatchingEntry[];
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<ContinueWatchingEntry[]>(NONE);
  const focused = useRef(false);
  const dirty = useRef(true);
  const gen = useRef(0);

  const load = useCallback((): Promise<void> => {
    const g = ++gen.current;
    dirty.current = false;
    return api
      .continueWatching()
      .then((res) => {
        if (g === gen.current) setItems(res.items);
      })
      .catch(() => {
        // What is on screen stays; the next focus or foreground tries again.
        if (g === gen.current) dirty.current = true;
      });
  }, []);

  // A sign-out drops the list at once, focused or not — Home stays mounted
  // under the Account tab, where one person signs out and the next signs in,
  // and its next focus must not show (or resume at) the previous account's
  // positions. Declared BEFORE the focus effect: on a flip while focused,
  // effects run in declaration order, so this one marks the list dirty and
  // retires the old generation before the focus effect starts the new load —
  // the other way round, that load's answer would be dropped as stale. A
  // switch always passes through signed-out today, so the boolean is enough.
  useEffect(() => {
    gen.current++;
    setItems(NONE);
    dirty.current = true;
  }, [signedIn]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (signedIn && dirty.current) void load();
      return () => {
        focused.current = false;
      };
    }, [signedIn, load]),
  );

  // Load now if someone is looking, otherwise on the next focus.
  const refresh = useCallback(() => {
    if (focused.current && signedIn) void load();
    else dirty.current = true;
  }, [signedIn, load]);

  const reload = useCallback(
    (): Promise<void> => (signedIn ? load() : Promise.resolve()),
    [signedIn, load],
  );

  useEffect(() => onProgressSaved(refresh), [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  return { items, reload };
}
