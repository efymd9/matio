"use client";

import { useEffect, useState } from "react";
import {
  CONSENT_CHANGED_EVENT,
  readConsentFromDocument,
} from "@/lib/cookie-consent";

// Live marketing-consent state for client components that must start/stop
// third-party tracking without a reload (the Meta Pixel uses the same cookie +
// CONSENT_CHANGED_EVENT pattern inline). Starts `false` and reads the real
// value in an effect on mount, so tracking always defaults OFF until consent is
// confirmed — the privacy-safe direction. Updates immediately when the banner
// broadcasts a decision.
//
// Safe for components that only render client-side (e.g. a token-gated
// <MuxVideo> or a dynamic(ssr:false) <MuxPlayer>): the effect has run by the
// time those mount, so they see the correct value at mount.
export function useMarketingConsent(): boolean {
  // Lazy initializer reads the cookie on first render — SSR-safe
  // (readConsentFromDocument returns null when `document` is undefined → false).
  // Keeping the read here (not in the effect) avoids a synchronous setState in
  // the effect body; the effect only ever setState()s inside the event handler.
  const [marketing, setMarketing] = useState(
    () => readConsentFromDocument()?.marketing === true,
  );
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ marketing?: boolean }>).detail;
      setMarketing(
        detail?.marketing ?? readConsentFromDocument()?.marketing === true,
      );
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);
  return marketing;
}
