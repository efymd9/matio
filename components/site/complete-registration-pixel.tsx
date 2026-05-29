"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";

// Fires CompleteRegistration once per user. Rendered on /subscribe, which new
// users hit immediately after Clerk sign-up (forceRedirectUrl), so it lands
// close to the actual registration. Browser-side rather than from the Clerk
// webhook because that webhook has no browser context (no fbp/fbc) and no
// consent signal — here both are available, and onPixelReady keeps it
// inherently consent-gated (it never fires without a loaded pixel).
//
// De-dupe is a localStorage flag keyed by user id, set only AFTER the event
// actually fires, so a not-yet-loaded pixel doesn't burn the flag.
export function CompleteRegistrationPixel({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return;
    const key = `matio:fb:creg:${userId}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // Storage blocked (private mode): fall through and fire anyway; Meta
      // de-dupes CompleteRegistration loosely.
    }
    return onPixelReady(() => {
      trackPixel("CompleteRegistration");
      try {
        localStorage.setItem(key, "1");
      } catch {
        // ignore storage write failures
      }
    });
  }, [userId]);
  return null;
}
