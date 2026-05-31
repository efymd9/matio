"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires Lead + CompleteRegistration (Meta) + signup_completed (PostHog) once
// per user. Rendered on /subscribe, which new users hit immediately after Clerk
// sign-up (forceRedirectUrl), so it lands close to the actual registration.
// Signup completion is our Meta "Lead" — a stronger intent signal than the
// trial preview, which no longer fires a Lead. Lead and CompleteRegistration
// share ONE dedup flag so they always fire together (or not at all), and so
// users who registered before this change (creg flag already set) don't
// retro-fire a Lead on their next /subscribe visit. All browser-side and
// inherently consent-gated (their ready-deferral never fires without a loaded
// SDK). De-dupe via a localStorage flag keyed by user id, set only AFTER the
// events actually fire so a not-yet-loaded SDK doesn't burn it.
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
          // Signup completion is our "Lead". CompleteRegistration stays as the
          // canonical registration event; both fire on the same trigger.
          trackPixel("Lead", { content_category: "signup" });
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
