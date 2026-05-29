"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  CONSENT_CHANGED_EVENT,
  readConsentFromDocument,
  type ConsentRecord,
} from "@/lib/cookie-consent";
import { META_PIXEL_ID } from "@/lib/meta-pixel-events";

// Consent-gated Meta Pixel loader. The fbevents.js base code is injected ONLY
// after the visitor accepts marketing cookies (ePrivacy/PECR/AEPD/CNIL), which
// matches how proxy.ts already gates attribution-cookie writes. Mounted once
// in app/layout.tsx next to <CookieBanner/>.
//
// `initialConsent` is parsed server-side in the layout so a returning,
// already-consented visitor gets the pixel on first paint (no flash, no race).
//
// Note: Meta's tag cannot be fully unloaded once injected, so the clean path
// is to never inject before consent and to call fbq('consent','revoke') if the
// user withdraws consent after it has loaded this session.
export function MetaPixel({
  initialConsent,
}: {
  initialConsent: ConsentRecord | null;
}) {
  const pathname = usePathname();
  // `enabled` controls whether the tag is injected (load-once — Meta's tag
  // can't be unloaded mid-session). `consentRef` tracks LIVE consent so we
  // stop emitting events the instant the user withdraws, without unmounting.
  const [enabled, setEnabled] = useState(initialConsent?.marketing === true);
  const consentRef = useRef(initialConsent?.marketing === true);
  // Path the inline base snippet already fired its PageView for, so the
  // route-change effect below doesn't double-count the first page.
  const trackedPathRef = useRef<string | null>(null);

  // React to a consent decision after load — no reload needed.
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ marketing?: boolean }>).detail;
      const marketing =
        detail?.marketing ?? readConsentFromDocument()?.marketing === true;
      consentRef.current = marketing;
      if (marketing) {
        // Resume tracking if it was revoked earlier this session. No-op before
        // fbq has loaded — the freshly-mounted tag grants by default — but
        // essential for an off→on toggle, where the tag is already loaded and
        // sitting in the revoked state.
        window.fbq?.("consent", "grant");
        setEnabled(true);
      } else {
        // Withdrawn after the tag loaded this session: halt tracking. We can't
        // unload the tag, so revoke and (via consentRef) stop emitting events.
        window.fbq?.("consent", "revoke");
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Fire PageView on client-side route changes. The base snippet fires the
  // first PageView itself; we record that path on activation and only fire for
  // genuinely new paths thereafter. Gated on LIVE consent so navigations after
  // a withdrawal don't keep emitting track calls.
  useEffect(() => {
    if (!enabled || !consentRef.current) return;
    if (trackedPathRef.current === null) {
      trackedPathRef.current = pathname;
      return;
    }
    if (trackedPathRef.current === pathname) return;
    trackedPathRef.current = pathname;
    window.fbq?.("track", "PageView");
  }, [enabled, pathname]);

  if (!enabled || !META_PIXEL_ID) return null;

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
window.__mfbqReady=true;
window.dispatchEvent(new Event('mfbq:ready'));`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
