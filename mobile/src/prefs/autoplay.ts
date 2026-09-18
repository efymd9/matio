import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";
import { settleOrNull } from "@/api/client";

// The «Play next episode automatically» setting (Settings → Playback, #245).
// A device-local preference, on by default; persisted the way the language
// choice is (SecureStore — the one store the app already has — behind
// settleOrNull, so a hung keychain can never block anything).
//
// Two readers with different needs: the Settings row wants a hook; the feed
// wants a SYNCHRONOUS answer at `ended`, where there is no room for a
// keychain round-trip. So the value is cached in the module — `primed` by
// the first read (the Settings screen, or the feed's own mount) and written
// through by the toggle — and autoplayNextEnabled() answers from the cache,
// defaulting to on until the read lands.
const AUTOPLAY_KEY = "matio_autoplay_next";
const READ_TIMEOUT_MS = 3_000;

let cached: boolean | null = null;
let pending: Promise<boolean> | null = null;

export function loadAutoplayNext(): Promise<boolean> {
  if (cached !== null) return Promise.resolve(cached);
  pending ??= settleOrNull(SecureStore.getItemAsync(AUTOPLAY_KEY), READ_TIMEOUT_MS).then(
    (stored) => {
      // Only an explicit "0" turns it off; anything else (unset, garbage,
      // a timed-out read) is the default.
      cached ??= stored !== "0";
      return cached;
    },
  );
  return pending;
}

export function autoplayNextEnabled(): boolean {
  if (cached === null) void loadAutoplayNext();
  return cached ?? true;
}

export function setAutoplayNext(enabled: boolean): void {
  cached = enabled;
  SecureStore.setItemAsync(AUTOPLAY_KEY, enabled ? "1" : "0").catch(() => {
    // A failed write costs one more tap next launch, nothing else.
  });
}

// The Settings row: the stored value once read (on until then), and a setter
// that flips the row optimistically and writes through.
export function useAutoplayNext(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(() => cached ?? true);

  useEffect(() => {
    let cancelled = false;
    void loadAutoplayNext().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((next: boolean) => {
    setEnabled(next);
    setAutoplayNext(next);
  }, []);

  return [enabled, update];
}
