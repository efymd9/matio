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
  measureOaiq,
  OAIQ_READY_EVENT,
  OAIQ_SDK_SRC,
  OPENAI_PIXEL_ID,
} from "@/lib/openai-pixel-events";

// Consent-gated ChatGPT Ads Measurement Pixel loader. OpenAI's oaiq.min.js is
// injected ONLY after the visitor accepts marketing cookies (ePrivacy/PECR/
// AEPD/CNIL) — the same gate proxy.ts uses for attribution writes and
// meta-pixel.tsx / google-analytics.tsx / posthog-provider.tsx use for their
// tags. Mounted once in app/layout.tsx next to <GoogleAnalytics/>.
//
// `initialConsent` is parsed server-side in the layout so a returning,
// already-consented visitor gets the pixel on first paint (no flash, no race).
//
// OpenAI's SDK has a first-class consent switch: oaiq('consent', false) stops
// every measurement ping (and persists the denial in its own cookie), and
// oaiq('consent', true) lifts it. The SDK defaults consent to TRUE at init —
// which is fine only because we never init before the visitor has consented.
// On a mid-session withdrawal we flip the switch AND stop our own calls via
// consentRef, mirroring the Meta / GA loaders.
export function OpenAIPixel({
  initialConsent,
}: {
  initialConsent: ConsentRecord | null;
}) {
  const pathname = usePathname();
  // `enabled` controls whether the SDK is injected (load-once — it can't be
  // unloaded mid-session). `consentRef` tracks LIVE consent so we stop
  // emitting the instant the user withdraws, without unmounting.
  const [enabled, setEnabled] = useState(initialConsent?.marketing === true);
  const consentRef = useRef(initialConsent?.marketing === true);
  // Path the inline snippet already measured page_viewed for, so the
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
        // Resume if withdrawn earlier this session. No-op before the SDK has
        // loaded (a fresh init defaults to consent=true), but essential for an
        // off→on toggle where the SDK is loaded and holding a stored denial.
        window.oaiq?.("consent", true);
        setEnabled(true);
      } else {
        // Withdrawn after the SDK loaded this session: halt every ping. We
        // can't unload the script, so flip its consent switch and (via
        // consentRef) stop emitting our own events.
        window.oaiq?.("consent", false);
      }
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Measure page_viewed on client-side route changes — the SDK fires nothing
  // by itself on navigation, and App Router never reloads the page. The
  // inline snippet measures the first page; we record that path on activation
  // and only fire for genuinely new paths thereafter. Gated on LIVE consent so
  // navigations after a withdrawal don't keep emitting.
  useEffect(() => {
    if (!enabled || !consentRef.current) return;
    if (trackedPathRef.current === null) {
      trackedPathRef.current = pathname;
      return;
    }
    if (trackedPathRef.current === pathname) return;
    trackedPathRef.current = pathname;
    measureOaiq("page_viewed", { type: "contents" });
  }, [enabled, pathname]);

  if (!enabled || !OPENAI_PIXEL_ID) return null;

  // OpenAI's official snippet, verbatim except: the ID comes from env, debug
  // is on only in development (it logs every ping to the console), and we
  // announce readiness for onOaiqReady() consumers. The `if(w.oaiq)return`
  // guard is the SDK's own SPA protection against a second injection.
  const debug = process.env.NODE_ENV === "development";

  return (
    <Script id="openai-pixel-base" strategy="afterInteractive">
      {`!function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q;var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];f.parentNode.insertBefore(j,f)}(window,document,"script","${OAIQ_SDK_SRC}");
oaiq("init",{pixelId:"${OPENAI_PIXEL_ID}",debug:${debug ? "true" : "false"}});
oaiq("measure","page_viewed",{type:"contents"});
window.__oaiqReady=true;
window.dispatchEvent(new Event("${OAIQ_READY_EVENT}"));`}
    </Script>
  );
}
