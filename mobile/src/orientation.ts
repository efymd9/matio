import { useFocusEffect } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { ShowOrientation } from "@/shared/api-types";

// Screen orientation (#252): the app is portrait everywhere except the
// landscape player. The OS is told to ALLOW every orientation (`app.json` →
// `orientation: "default"`; a `portrait` there also pins the fullscreen
// AVPlayerViewController, which is the bug the issue starts from) and
// expo-screen-orientation decides per screen: the root layout locks
// PORTRAIT_UP once at launch, the watch screen locks LANDSCAPE for a
// horizontal show WHILE IT IS FOCUSED and hands portrait back the moment it
// is not — another screen pushed over it (sign-in from the wall) or its own
// unmount. A vertical show re-asserts PORTRAIT_UP, so a swipe feed never
// inherits a stale landscape.
//
// One module, one controller: the native registry keeps a single mask for it,
// so the latest lock simply wins — there is no stack to unwind.

export const PORTRAIT_LOCK = ScreenOrientation.OrientationLock.PORTRAIT_UP;

// LANDSCAPE, not LANDSCAPE_RIGHT: both sides are allowed, so the viewer picks
// the side (the charging port) and the OS rotates between them.
export function orientationLockFor(orientation: ShowOrientation): ScreenOrientation.OrientationLock {
  return orientation === "horizontal" ? ScreenOrientation.OrientationLock.LANDSCAPE : PORTRAIT_LOCK;
}

// Best-effort by design: the module throws for a lock the device cannot take
// (UnsupportedOrientationLock) and the promise must never reach a render as a
// rejection — an unrotated player still plays.
export function lockOrientation(lock: ScreenOrientation.OrientationLock): void {
  void ScreenOrientation.lockAsync(lock).catch(() => undefined);
}

// Which focus the screen is in: `null` while another screen covers it (or
// before navigation has settled), otherwise a counter that grows on every
// focus — so a consumer can tell "focused again" from "still focused".
export type FocusSession = number | null;

// The watch screen's lock. Taken while the screen is focused AND the show is
// known (`null` while it loads — the orientation is a property of the show —
// locks nothing and, on unmount, restores nothing that was not taken).
// Released to portrait on blur — /sign-in pushed from the wall is a portrait
// screen (spec) and would otherwise render in landscape with the keyboard up
// — and taken again on focus. Returns the focus session for
// useOrientationSettled.
export function useOrientationLock(orientation: ShowOrientation | null): FocusSession {
  const [focus, setFocus] = useState<FocusSession>(null);
  // Monotonic across blurs — the state itself goes through null.
  const sessions = useRef(0);

  useFocusEffect(
    useCallback(() => {
      sessions.current += 1;
      setFocus(sessions.current);
      return () => setFocus(null);
    }, []),
  );

  useEffect(() => {
    if (focus === null || orientation === null) return;
    lockOrientation(orientationLockFor(orientation));
    return () => lockOrientation(PORTRAIT_LOCK);
  }, [focus, orientation]);

  return focus;
}

// How long the watch screen waits for the window to take the show's shape
// before mounting the feed in whatever shape it has. A phone rotates within
// a frame or two of the lock; this only ever elapses where the lock does not
// act — an iPad that multitasks ignores it, a device may refuse it.
export const ORIENTATION_GRACE_MS = 1_000;

// Whether the feed may be mounted: the screen is focused and the window
// already has the show's shape — landscape for a horizontal show, portrait
// for a vertical one. The lock is asynchronous, and a FlatList lays its pages
// out by the window it MOUNTS with: it keeps its pixel offset across a
// resize, and the render window is rebuilt from that stale offset, so the
// current page is dropped and re-created for any index above 0 — a second
// token, a restarted player (seen in the simulator). Hence the feed is never
// resized while mounted on a phone: held back until the shape is right, and
// UNMOUNTED while another screen covers this one (the blur releases the lock
// to portrait, which would be exactly such a resize). The grace period is per
// focus, after which the feed mounts in whatever shape the screen has. An
// iPad is never held while focused: with multitasking on, iPadOS ignores
// supportedInterfaceOrientations, and the wait would be a spinner for nothing.
export function useOrientationSettled(orientation: ShowOrientation | null, focus: FocusSession): boolean {
  const { width, height } = useWindowDimensions();
  // The (shape, focus) whose grace period has elapsed — compared to the
  // current pair, so a change of either re-arms without a reset.
  const [graceOverFor, setGraceOverFor] = useState<string | null>(null);
  const graceKey = orientation === null || focus === null ? null : `${orientation}:${focus}`;

  useEffect(() => {
    if (graceKey === null) return;
    const timer = setTimeout(() => setGraceOverFor(graceKey), ORIENTATION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [graceKey]);

  if (graceKey === null) return false;
  if (Platform.OS === "ios" && Platform.isPad) return true;
  const landscape = width > height;
  return (orientation === "horizontal") === landscape || graceOverFor === graceKey;
}
