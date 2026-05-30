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
        window.posthog?.opt_out_capturing();
        window.posthog?.reset();
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Initialize posthog-js exactly once, after consent. Dynamic import so the
  // SDK is never in the bundle for non-consenting visitors.
  useEffect(() => {
    if (!enabled || initializedRef.current || !POSTHOG_KEY) return;
    initializedRef.current = true;
    void import("posthog-js").then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        ui_host: "https://eu.posthog.com",
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: false, // fired manually below for App-Router routes
        capture_pageleave: true,
        enable_heatmaps: true,
        disable_session_recording: false,
        session_recording: { maskAllInputs: true, maskTextSelector: "*" },
        loaded: (ph) => {
          window.posthog = ph as unknown as Window["posthog"];
          window.__phReady = true;
          lastPathRef.current = window.location.pathname;
          ph.capture("$pageview");
          setReady(true);
          window.dispatchEvent(new Event(POSTHOG_READY_EVENT));
        },
      });
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

  // Stitch the anonymous person to the Clerk user once known; reset on sign-out.
  useEffect(() => {
    if (!enabled || !ready || !consentRef.current) return;
    if (isSignedIn && userId) {
      if (identifiedRef.current === userId) return;
      identifiedRef.current = userId;
      const email = user?.primaryEmailAddress?.emailAddress;
      window.posthog?.identify(userId, email ? { email } : undefined);
    } else if (isSignedIn === false && identifiedRef.current) {
      identifiedRef.current = null;
      window.posthog?.reset();
    }
  }, [enabled, ready, isSignedIn, userId, user]);

  return null;
}
