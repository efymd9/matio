"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CONSENT_CHANGED_EVENT,
  readConsentFromDocument,
  type ConsentRecord,
} from "@/lib/cookie-consent";
import {
  GA_CONSENT_DENIED,
  GA_CONSENT_GRANTED,
  GA_MEASUREMENT_ID,
  GA_READY_EVENT,
  setGaDisabled,
} from "@/lib/ga-events";

// Consent-gated Google Analytics 4 loader. gtag.js is injected ONLY after the
// visitor accepts marketing cookies (ePrivacy/PECR/AEPD/CNIL) — the same gate
// proxy.ts uses for attribution writes and meta-pixel.tsx / posthog-provider.tsx
// use for their tags. Mounted once in app/layout.tsx next to <MetaPixel/>.
//
// `initialConsent` is parsed server-side in the layout so a returning,
// already-consented visitor gets GA on first paint (no flash, no race).
//
// Like Meta's tag, gtag.js cannot be fully unloaded once injected, so the clean
// path is to never inject before consent and, if the user withdraws consent
// this session, to BOTH push a Consent Mode v2 `consent: 'update'` → 'denied'
// AND flip GA's `ga-disable-<id>` kill-switch. Consent Mode 'denied' alone only
// drops cookies/identifiers — it keeps sending anonymized "ping" beacons; the
// ga-disable flag is what actually halts all transmission (the real equivalent
// of fbq('consent','revoke')).
export function GoogleAnalytics({
  initialConsent,
}: {
  initialConsent: ConsentRecord | null;
}) {
  const pathname = usePathname();
  // `enabled` controls whether the tag is injected (load-once — gtag.js can't
  // be unloaded mid-session). `consentRef` tracks LIVE consent so we stop
  // emitting page_view events the instant the user withdraws, without unmounting.
  const [enabled, setEnabled] = useState(initialConsent?.marketing === true);
  const consentRef = useRef(initialConsent?.marketing === true);
  // Path the inline config already counted a page_view for, so the route-change
  // effect below doesn't double-count the first page.
  const trackedPathRef = useRef<string | null>(null);

  // React to a consent decision after load — no reload needed.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ marketing?: boolean }>).detail;
      const marketing =
        detail?.marketing ?? readConsentFromDocument()?.marketing === true;
      consentRef.current = marketing;
      if (marketing) {
        // Resume tracking if revoked earlier this session. Clear the kill-switch
        // FIRST, then grant Consent Mode. No-op before gtag has loaded (the
        // freshly-injected tag defaults to granted + not-disabled), but essential
        // for an off→on toggle where the tag is already loaded and disabled.
        setGaDisabled(false);
        window.gtag?.("consent", "update", GA_CONSENT_GRANTED);
        setEnabled(true);
      } else {
        // Withdrawn after the tag loaded this session: genuinely halt tracking.
        // We can't unload gtag.js, so we (1) set ga-disable-<id> so gtag stops
        // sending ALL hits incl. cookieless pings, (2) deny Consent Mode storage,
        // and (3) via consentRef stop emitting our own page_view calls.
        setGaDisabled(true);
        window.gtag?.("consent", "update", GA_CONSENT_DENIED);
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Fire page_view on client-side route changes. GA's gtag config sends the
  // first page_view itself; we record that path on activation and only fire for
  // genuinely new paths thereafter (App Router doesn't reload the page). Gated
  // on LIVE consent so navigations after a withdrawal don't keep emitting.
  useEffect(() => {
    if (!enabled || !consentRef.current) return;
    if (trackedPathRef.current === null) {
      trackedPathRef.current = pathname;
      return;
    }
    if (trackedPathRef.current === pathname) return;
    trackedPathRef.current = pathname;
    window.gtag?.("event", "page_view", {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [enabled, pathname]);

  if (!enabled || !GA_MEASUREMENT_ID) return null;

  return (
    <>
      <Script
        id="ga-gtag-js"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('consent', 'default', ${JSON.stringify(GA_CONSENT_GRANTED)});
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');
window.__gaReady = true;
window.dispatchEvent(new Event('${GA_READY_EVENT}'));`}
      </Script>
    </>
  );
}
