"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CONSENT_VERSION,
  COOKIE_PREFS_EVENT,
  broadcastConsentChange,
  clearMarketingCookies,
  writeConsentToDocument,
  type ConsentRecord,
} from "@/lib/cookie-consent";
import { useT } from "@/lib/i18n/client";

// Bottom-bar consent banner. Mounted in the root layout. Hidden while a
// valid consent cookie exists; reopens when the user clicks the
// "Cookie preferences" link in the footer (which dispatches
// COOKIE_PREFS_EVENT).
//
// Two equally prominent buttons — "Accept all" and "Essential only" —
// satisfy ICO/AEPD/CNIL guidance that rejecting must be no harder than
// accepting. No multi-step "Customize" flow needed because the only
// non-essential category we set is `marketing`.
export function CookieBanner({
  initialConsent,
}: {
  initialConsent: ConsentRecord | null;
}) {
  const [visible, setVisible] = useState(initialConsent === null);
  const t = useT();

  // Reopen handler — footer "Cookie preferences" button dispatches this.
  // setState only happens in the event callback (not synchronously in the
  // effect body), so React 19's set-state-in-effect rule stays happy.
  useEffect(() => {
    const open = () => setVisible(true);
    window.addEventListener(COOKIE_PREFS_EVENT, open);
    return () => window.removeEventListener(COOKIE_PREFS_EVENT, open);
  }, []);

  if (!visible) return null;

  const accept = () => {
    writeConsentToDocument({
      necessary: true,
      marketing: true,
      ts: Date.now(),
      v: CONSENT_VERSION,
    });
    // Tell the Meta Pixel loader it may start now — no reload needed.
    broadcastConsentChange(true);
    setVisible(false);
  };

  const reject = () => {
    writeConsentToDocument({
      necessary: true,
      marketing: false,
      ts: Date.now(),
      v: CONSENT_VERSION,
    });
    // Also clear any marketing cookies that may have been set on prior
    // visits before the banner shipped.
    clearMarketingCookies();
    // Signal the Pixel to revoke consent if it was already loaded this session.
    broadcastConsentChange(false);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-banner-heading"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rust/30 bg-espresso-2/95 backdrop-blur-2xl pl-[max(env(safe-area-inset-left),1rem)] pr-[max(env(safe-area-inset-right),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 sm:pt-5"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex-1 space-y-1.5">
          <p
            id="cookie-banner-heading"
            className="text-sm font-bold tracking-tight text-cream"
          >
            {t.cookieBanner.title}
          </p>
          <p className="text-[13px] leading-snug text-cream/65">
            {t.cookieBanner.body}{" "}
            <Link
              href="/cookies"
              className="font-medium text-cream/85 underline underline-offset-2 transition-colors hover:text-cream"
            >
              {t.cookieBanner.learnMore}
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={reject}
            className="inline-flex h-11 items-center justify-center rounded-full border border-cream/15 bg-cream/5 px-6 text-sm font-semibold text-cream transition-colors hover:bg-cream/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/40"
          >
            {t.cookieBanner.essentialOnly}
          </button>
          <button
            type="button"
            onClick={accept}
            className="inline-flex h-11 items-center justify-center rounded-full bg-gold-cta px-6 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform hover:brightness-105 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
          >
            {t.cookieBanner.acceptAll}
          </button>
        </div>
      </div>
    </div>
  );
}
