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
import { useLocale } from "@/lib/i18n/client";
import { LOCALE_COOKIE_NAME } from "@/lib/i18n/shared";
import { normalizeUtm, normalizeUtmSource } from "@/lib/utm";

// Super-property payload: which language the UI is in, and whether that's
// the visitor's explicit pick (locale cookie present — written only by the
// language switcher) or server-side Accept-Language/geo detection
// (lib/i18n/negotiate.ts). Lets funnels segment es vs en and measure how
// often detection gets overridden.
function localeProps(locale: string): Record<string, unknown> {
  const chosen =
    typeof document !== "undefined" &&
    document.cookie
      .split(";")
      .some((c) => c.trim().startsWith(`${LOCALE_COOKIE_NAME}=`));
  return { locale, locale_source: chosen ? "chosen" : "detected" };
}

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
  const locale = useLocale();

  const [enabled, setEnabled] = useState(initialConsent?.marketing === true);
  const [ready, setReady] = useState(false);
  const consentRef = useRef(initialConsent?.marketing === true);
  // Ref mirror so the init effect's `loaded` callback (deps: [enabled])
  // registers the CURRENT locale before the first $pageview, not the one
  // closed over when consent flipped. Synced in an effect (not during
  // render — react-hooks/refs); declared before the init effect so it
  // commits first, and `loaded` itself fires async long after.
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
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
          // "always" (not "identified_only") so PostHog writes the native
          // $initial_utm_* person props (via $set_once on the first event of an
          // anonymous lander) — the first-touch attribution our delayed-
          // conversion funnel needs for ad ROAS. identified_only never created
          // the profile pre-signup, so $initial_utm_* stayed permanently None.
          person_profiles: "always",
          autocapture: false,
          capture_pageview: false, // fired manually below for App-Router routes
          capture_pageleave: true,
          enable_heatmaps: true,
          // Recording is ON (masked). false is posthog-js's default — stated
          // explicitly to document the deliberate choice (double-negative name).
          disable_session_recording: false,
          session_recording: { maskAllInputs: true, maskTextSelector: "*" },
          // Normalize the auto-captured UTM values before any event is sent, so
          // a stray char (e.g. a leaked ">" from a malformed ad link) or case
          // drift can't fragment a campaign. Mirrors the app's attribution
          // clean() + the PostHog funnel breakdown. Mutates ONLY the utm_*
          // values (never deletes reserved keys) and always returns the event.
          before_send: (event) => {
            const props = event?.properties;
            if (props) {
              for (const k of ["utm_campaign", "utm_source", "utm_medium"]) {
                if (typeof props[k] === "string") {
                  // utm_source also gets platform-alias canonicalization
                  // (facebook/meta→fb, instagram→ig) to match the app's
                  // attribution columns; medium/campaign keep plain normalize.
                  const n =
                    k === "utm_source"
                      ? normalizeUtmSource(props[k])
                      : normalizeUtm(props[k]);
                  if (n) props[k] = n;
                }
              }
            }
            return event;
          },
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
            // Attach the language super-props before the first event so even
            // the initial $pageview is segmentable by locale.
            ph.register(localeProps(localeRef.current));
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

  // Keep the language super-props current when the user flips the switcher
  // (the optimistic LocaleProvider re-renders us with the new locale, and the
  // cookie it just wrote flips locale_source to "chosen").
  useEffect(() => {
    if (!enabled || !ready || !consentRef.current) return;
    window.posthog?.register(localeProps(locale));
  }, [enabled, ready, locale]);

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
      // reset() clears SUPER PROPERTIES too — re-attach the language props
      // (ref keeps `locale` out of this effect's deps; its sync effect is
      // declared earlier, so it's current by the time we run) or every
      // post-logout anonymous event loses its locale segmentation.
      window.posthog?.register(localeProps(localeRef.current));
    }
  }, [enabled, ready, isSignedIn, userId, email]);

  return null;
}
