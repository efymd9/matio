"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires CompleteRegistration (Meta) + signup_completed (PostHog) once per user.
// Rendered on /subscribe, which new users hit immediately after Clerk sign-up
// (forceRedirectUrl), so it lands close to the actual registration. Both are
// browser-side and inherently consent-gated (their ready-deferral never fires
// without a loaded SDK). De-dupe via a localStorage flag keyed by user id, set
// only AFTER each event actually fires so a not-yet-loaded SDK doesn't burn it.
export function CompleteRegistrationPixel({ userId }: { userId: string }) {
  useEffect(() => {
    if (!userId) return;

    const fbKey = `matio:fb:creg:${userId}`;
    let fbDone = false;
    try {
      fbDone = !!localStorage.getItem(fbKey);
    } catch {
      // Storage blocked (private mode): fall through and fire anyway.
    }
    const offPixel = fbDone
      ? () => {}
      : onPixelReady(() => {
          trackPixel("CompleteRegistration");
          try {
            localStorage.setItem(fbKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    const phKey = `matio:ph:signup:${userId}`;
    let phDone = false;
    try {
      phDone = !!localStorage.getItem(phKey);
    } catch {
      // Storage blocked: fire anyway; PostHog funnels count first occurrence.
    }
    const offPostHog = phDone
      ? () => {}
      : onPostHogReady(() => {
          capturePostHog("signup_completed");
          try {
            localStorage.setItem(phKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    return () => {
      offPixel();
      offPostHog();
    };
  }, [userId]);
  return null;
}
