"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires CompleteRegistration (Meta) + signup_completed (PostHog) once per
// user, at the account-materialization moment: first authed /subscribe for
// the signed-in flow, post-sign-in /welcome for pay-first buyers. Meta Lead
// moved to the paywall (2026-06-10 funnel mapping: ViewContent at play start
// → Lead at the paywall → InitiateCheckout at the CTA → Purchase) — it no
// longer fires here; the localStorage key keeps its historical "creg" name
// so users who fired before the change don't retro-fire. All browser-side
// and inherently consent-gated (the ready-deferral never fires without a
// loaded SDK). De-dupe via a localStorage flag keyed by user id, set only
// AFTER the events actually fire so a not-yet-loaded SDK doesn't burn it.
export function CompleteRegistrationPixel({
  userId,
  utm,
}: {
  userId: string;
  // First-touch UTM (server-resolved from the attribution_first cookie on
  // /subscribe) so signup_completed carries campaign attribution — by signup
  // time the URL has no utm_* params, so posthog-js can't auto-attach them.
  utm?: Record<string, string>;
}) {
  // Re-running on a utm change is safe: the cleanup below detaches the prior
  // ready-listeners before re-registering, so signup_completed still fires at
  // most once (also guarded by the phKey localStorage flag).
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
          capturePostHog("signup_completed", utm);
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
  }, [userId, utm]);
  return null;
}
