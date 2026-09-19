import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import type { ShowOrientation } from "@/shared/api-types";

// Screen orientation (#252): the app is portrait everywhere except the
// landscape player. The OS is told to ALLOW every orientation (`app.json` →
// `orientation: "default"`; a `portrait` there also pins the fullscreen
// AVPlayerViewController, which is the bug the issue starts from) and
// expo-screen-orientation decides per screen: the root layout locks
// PORTRAIT_UP once at launch, the watch screen locks LANDSCAPE for a
// horizontal show and hands portrait back when it unmounts. A vertical show
// re-asserts PORTRAIT_UP, so a swipe feed never inherits a stale landscape.
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

// The watch screen's lock. `null` while the show is still loading — the
// orientation is a property of the show, known only once it has arrived —
// locks nothing and, on unmount, restores nothing that was not taken.
export function useOrientationLock(orientation: ShowOrientation | null): void {
  useEffect(() => {
    if (orientation === null) return;
    lockOrientation(orientationLockFor(orientation));
    return () => lockOrientation(PORTRAIT_LOCK);
  }, [orientation]);
}

// How long the watch screen waits for the window to take the show's shape
// before mounting the feed in whatever shape it has. A phone rotates within
// a frame or two of the lock; this only ever elapses where the lock does not
// act — an iPad that multitasks ignores it, a device may refuse it.
export const ORIENTATION_GRACE_MS = 1_000;

// Whether the window already has the show's shape — landscape for a
// horizontal show, portrait for a vertical one. The lock is asynchronous, and
// the feed lays its pages out by the window height it MOUNTS with (a
// FlatList keeps its pixel offset across a resize, so a page mounted in
// portrait and rotated under a resume at episode 3 is dropped and re-created
// by the list — a second token, a restarted player; seen in the simulator).
// So the watch screen holds the feed back until this is true, or until the
// grace period is over. An iPad is never held: with multitasking on, iPadOS
// ignores supportedInterfaceOrientations, and the wait would be a spinner
// for nothing.
export function useOrientationSettled(orientation: ShowOrientation | null): boolean {
  const { width, height } = useWindowDimensions();
  // The orientation whose grace period has elapsed — compared to the
  // current one, so a change of show re-arms without a reset.
  const [graceOverFor, setGraceOverFor] = useState<ShowOrientation | null>(null);

  useEffect(() => {
    if (orientation === null) return;
    const timer = setTimeout(() => setGraceOverFor(orientation), ORIENTATION_GRACE_MS);
    return () => clearTimeout(timer);
  }, [orientation]);

  if (orientation === null) return false;
  if (Platform.OS === "ios" && Platform.isPad) return true;
  const landscape = width > height;
  return (orientation === "horizontal") === landscape || graceOverFor === orientation;
}
