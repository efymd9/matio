"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  CONSENT_CHANGED_EVENT,
  readConsentFromDocument,
  type ConsentRecord,
} from "@/lib/cookie-consent";
import {
  POSTHOG_HOST,
  POSTHOG_KEY,
  POSTHOG_READY_EVENT,
} from "@/lib/posthog-events";

// Consent-gated PostHog loader. posthog-js is dynamically imported ONLY after
// the visitor accepts marketing cookies (same gate proxy.ts uses for
// attribution writes and meta-pixel.tsx uses for fbevents.js). The dynamic
// import also keeps the SDK out of the initial bundle for everyone — it loads
// at most once, after consent. Mounted once in app/layout.tsx next to
// <MetaPixel/>, sharing the same server-parsed initialConsent so an
// already-consented returning visitor is tracked on first paint.
export function PostHogProvider({
  initialConsent,
}: {
  initialConsent: ConsentRecord | null;
}) {
  const pathname = usePathname();
  const { isSignedIn, userId } = useAuth();
  const { user } = useUser();

  const [enabled, setEnabled] = useState(initialConsent?.marketing === true);
  const [ready, setReady] = useState(false);
  const consentRef = useRef(initialConsent?.marketing === true);
  const initializedRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const identifiedRef = useRef<string | null>(null);

  // React to a consent decision after load — no reload needed.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ marketing?: boolean }>).detail;
      const marketing =
        detail?.marketing ?? readConsentFromDocument()?.marketing === true;
      consentRef.current = marketing;
      if (marketing) {
        // Resume if revoked earlier this session (no-op before init).
        window.posthog?.opt_in_capturing();
        setEnabled(true);
      } else {
        // Withdrawn after load: stop capturing + drop the identified person.
        // setEnabled(false) keeps state truthful and prevents a re-init without
        // consent if the component ever remounts. We deliberately KEEP
        // initializedRef = true so a later re-grant resumes the already-loaded
        // SDK via opt_in_capturing() instead of re-running the dynamic import.
        window.posthog?.opt_out_capturing();
        window.posthog?.reset();
        setEnabled(false);
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Initialize posthog-js exactly once, after consent. Dynamic import so the
  // SDK is never in the bundle for non-consenting visitors. posthog-js retains
  // its state across opt_out/opt_in, so we never re-init on a re-grant —
  // opt_in_capturing() resumes the already-loaded SDK (see consent handler).
  useEffect(() => {
    if (!enabled || initializedRef.current || !POSTHOG_KEY) return;
    initializedRef.current = true;
    void import("posthog-js")
      .then(({ default: posthog }) => {
        // Consent can be withdrawn while the chunk downloads. If so, DON'T
        // initialize at all (no cookies, replay, or beacons) and release the
        // guard so a later re-grant can initialize cleanly.
        if (!consentRef.current) {
          initializedRef.current = false;
          return;
        }
        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          ui_host: "https://eu.posthog.com",
          person_profiles: "identified_only",
          autocapture: false,
          capture_pageview: false, // fired manually below for App-Router routes
          capture_pageleave: true,
          enable_heatmaps: true,
          // Recording is ON (masked). false is posthog-js's default — stated
          // explicitly to document the deliberate choice (double-negative name).
          disable_session_recording: false,
          session_recording: { maskAllInputs: true, maskTextSelector: "*" },
          loaded: (ph) => {
            window.posthog = ph as unknown as Window["posthog"];
            window.__phReady = true;
            // Withdrawn during init's remote-config fetch: opt out (tears down
            // the cookies/replay init just established) and emit nothing.
            if (!consentRef.current) {
              ph.opt_out_capturing();
              return;
            }
            lastPathRef.current = window.location.pathname;
            ph.capture("$pageview");
            setReady(true);
            window.dispatchEvent(new Event(POSTHOG_READY_EVENT));
          },
        });
      })
      .catch(() => {
        // posthog-js failed to load (network/CDN block). Analytics is
        // best-effort — never fatal. Release the guard so a later enable
        // change can retry.
        initializedRef.current = false;
      });
  }, [enabled]);

  // Fire $pageview on client-side route changes. The loaded callback fires the
  // first one and records its path; we only fire for genuinely new paths after.
  useEffect(() => {
    if (!enabled || !ready || !consentRef.current) return;
    if (lastPathRef.current === pathname) return;
    lastPathRef.current = pathname;
    window.posthog?.capture("$pageview");
  }, [enabled, ready, pathname]);

  // Derived once so the identify effect deps on the email string, not the whole
  // mutable Clerk user object (which would re-run on any profile change).
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  // Stitch the anonymous person to the Clerk user once known; reset on sign-out.
  useEffect(() => {
    if (!enabled || !ready || !consentRef.current) return;
    if (isSignedIn && userId) {
      if (identifiedRef.current === userId) return;
      identifiedRef.current = userId;
      window.posthog?.identify(userId, email ? { email } : undefined);
    } else if (isSignedIn === false && identifiedRef.current) {
      identifiedRef.current = null;
      window.posthog?.reset();
    }
  }, [enabled, ready, isSignedIn, userId, email]);

  return null;
}
