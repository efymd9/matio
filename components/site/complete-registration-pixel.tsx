"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";
import { measureOaiq, onOaiqReady } from "@/lib/openai-pixel-events";
import { readConsentFromDocument } from "@/lib/cookie-consent";

// Fires CompleteRegistration (Meta) + signup_completed (PostHog) +
// subscription_created (OpenAI / ChatGPT Ads) once per user, at the
// account-materialization moment: first authed /subscribe for
// the signed-in flow, post-sign-in /welcome for pay-first buyers. Meta Lead
// moved to the paywall (2026-06-10 funnel mapping: ViewContent at play start
// → Lead at the paywall → InitiateCheckout at the CTA → Purchase) — it no
// longer fires here; the localStorage key keeps its historical "creg" name
// so users who fired before the change don't retro-fire. All browser-side.
// Consent is checked twice, on purpose: the ready-deferral never fires
// without a loaded SDK (none loads without marketing consent), AND every
// callback re-reads the live consent cookie before firing — "loaded" is not
// "consented". None of the SDKs can be unloaded, so after a mid-session
// withdrawal fbq (in `consent revoke`), posthog (opted out) and oaiq all stay
// present but silently drop every event. De-dupe via a localStorage flag
// keyed by user id, set only AFTER the event actually fires: a not-yet-loaded
// SDK or a withdrawn consent must not burn it, or this user's conversion is
// lost forever — even after they grant consent again (#147).
export function CompleteRegistrationPixel({
  userId,
  utm,
  paymentsEnabled = false,
}: {
  userId: string;
  // Paid mode: a registration is a registration (`registration_completed`);
  // the purchase itself is measured by <PurchasePixel/> on the checkout
  // return. Free mode: creating an account IS the plan enrollment, so the
  // campaign's configured conversion (`subscription_created`) fires here.
  paymentsEnabled?: boolean;
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
          // Live consent, not "SDK loaded" — see the module comment.
          if (readConsentFromDocument()?.marketing !== true) return;
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
          // Live consent, not "SDK loaded" — see the module comment.
          if (readConsentFromDocument()?.marketing !== true) return;
          capturePostHog("signup_completed", utm);
          try {
            localStorage.setItem(phKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    // ChatGPT Ads. Paid mode: this is a registration (`registration_completed`)
    // and the purchase is measured by <PurchasePixel/> on the checkout return.
    // Free mode: creating an account IS the plan enrollment, so the campaign's
    // configured conversion (`subscription_created`, plan "free-membership")
    // fires here. Only documented fields (the SDK rejects unknown ones);
    // event_id keys a future Conversions-API dedupe. No PII — opaque Clerk id.
    const oaKey = `matio:oaiq:signup:${userId}`;
    let oaDone = false;
    try {
      oaDone = !!localStorage.getItem(oaKey);
    } catch {
      // Storage blocked: fire anyway; event_id dedupes on OpenAI's side.
    }
    const offOaiq = oaDone
      ? () => {}
      : onOaiqReady(() => {
          // Live consent, not "SDK loaded" — see the module comment.
          if (readConsentFromDocument()?.marketing !== true) return;
          if (paymentsEnabled) {
            measureOaiq(
              "registration_completed",
              { type: "customer_action" },
              { event_id: `signup:${userId}` },
            );
          } else {
            measureOaiq(
              "subscription_created",
              { type: "plan_enrollment", plan_id: "free-membership" },
              { event_id: `signup:${userId}` },
            );
          }
          try {
            localStorage.setItem(oaKey, "1");
          } catch {
            // ignore storage write failures
          }
        });

    return () => {
      offPixel();
      offPostHog();
      offOaiq();
    };
  }, [userId, utm, paymentsEnabled]);
  return null;
}
