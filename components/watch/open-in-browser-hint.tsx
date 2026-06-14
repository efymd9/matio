"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

// Funnel finding (2026-06): ~60% of ad traffic lands in the Facebook/Instagram
// in-app browser (WKWebView on iOS, System WebView on Android). Apple Pay /
// Google Pay express checkout typically does NOT render inside those webviews,
// so the $1 guest checkout drops to hand-typing a card — a conversion killer
// at exactly the moment this hint shows (the in-player paywall CTA).
//
// We can't force an escape on iOS (no API), so that branch only instructs.
// On Android an intent:// URL hands the page to Chrome, where Google Pay works.

type Platform = "ios" | "android" | "other";
type InAppEnv = { inApp: boolean; platform: Platform };

function detectInAppEnv(): InAppEnv {
  if (typeof navigator === "undefined") {
    return { inApp: false, platform: "other" };
  }
  const ua = navigator.userAgent || "";
  // The Meta webviews carry these UA tokens on BOTH platforms (the Android FB
  // webview reports FB_IAB/FB4A even though it otherwise shares Chrome's UA).
  const inApp = /FBAN|FBAV|FB_IAB|FB4A|Instagram/i.test(ua);
  const platform: Platform = /iPhone|iPad|iPod/i.test(ua)
    ? "ios"
    : /Android/i.test(ua)
      ? "android"
      : "other";
  return { inApp, platform };
}

// Hands the current page off to Chrome on Android. browser_fallback_url keeps
// users without Chrome on their default browser instead of dead-ending.
function chromeIntentUrl(): string {
  const { host, pathname, search, hash, href } = window.location;
  return `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
    href,
  )};end`;
}

export function OpenInBrowserHint() {
  // Detection is constant for the session and only ever runs client-side (the
  // paywall is a conditionally-rendered, client-only end-state — never in the
  // server HTML), so a lazy initializer is SSR-safe and avoids setState-in-effect.
  const [env] = useState<InAppEnv>(detectInAppEnv);
  const [dismissed, setDismissed] = useState(false);
  const t = useT();

  if (!env.inApp || env.platform === "other" || dismissed) return null;

  return (
    <div className="mt-3 flex items-start gap-2 rounded-lg border border-white/12 bg-white/[0.06] px-3 py-2 text-left">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="mt-0.5 shrink-0 text-white/55"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      <div className="min-w-0 flex-1 text-[11px] leading-snug text-white/75">
        {env.platform === "android" ? (
          <>
            <span>{t.paywall.openInBrowserAndroid}</span>{" "}
            <button
              type="button"
              onClick={() => {
                window.location.href = chromeIntentUrl();
              }}
              className="font-semibold text-white underline underline-offset-2 transition-colors hover:text-white/80"
            >
              {t.paywall.openInBrowserAndroidCta}
            </button>
          </>
        ) : (
          <span>{t.paywall.openInBrowserIos}</span>
        )}
      </div>
      <button
        type="button"
        aria-label={t.paywall.openInBrowserDismiss}
        onClick={() => setDismissed(true)}
        className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-white/40 transition-colors hover:text-white/80"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
