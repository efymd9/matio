"use client";

import { useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/client";
import { detectInAppBrowser, type InAppBrowserEnv } from "@/lib/in-app-browser";

// Stable no-op subscribe for the client-only gate below (the value never
// changes after mount, so there's nothing to subscribe to).
const noopSubscribe = () => () => {};

// Funnel finding (2026-06): ~60% of ad traffic lands in the Facebook/Instagram
// in-app browser (WKWebView on iOS, System WebView on Android). Those webviews
// break the account flow three ways — Google OAuth is blocked, the checkout_claim
// cookie is dropped across the Stripe round-trip, and Apple/Google Pay + the
// Embedded Checkout iframe are flaky. The single reliable fix is to get the user
// into their real browser, so this is now a PROMINENT escape (not a footnote):
//   - Android: an intent:// URL hands the page to Chrome (Google Pay + Clerk work).
//   - iOS: no API can force an escape, so we instruct AND offer a tap-to-copy of
//     the current URL so the user can paste it into Safari.
// Detection is the shared, pure matcher (lib/in-app-browser.ts) used server-side
// too. Renders nothing outside an in-app browser, so callers can mount it
// unconditionally (it's mounted on the paywall and the /welcome sign-in fallback).

// Hands the current page off to Chrome on Android. browser_fallback_url keeps
// users without Chrome on their default browser instead of dead-ending.
function chromeIntentUrl(): string {
  const { host, pathname, search, hash, href } = window.location;
  return `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
    href,
  )};end`;
}

export function OpenInBrowserHint() {
  // Hydration-safe client gate: false during SSR + the hydration render (so it
  // matches the server's null output), true afterwards. The paywall never
  // server-renders this (it's a client-only end-state), but the /welcome
  // sign-in fallback DOES server-render it — without this gate the
  // navigator-based lazy init below would mismatch on hydration there. No
  // setState-in-effect (repo lint rule) — useSyncExternalStore handles it.
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  // Detection is constant for the session; a lazy initializer is SSR-safe
  // (navigator is undefined on the server → not-in-app) and avoids
  // setState-in-effect. Gated behind isClient before it can affect output.
  const [env] = useState<InAppBrowserEnv>(() =>
    typeof navigator === "undefined"
      ? { inApp: false, platform: "other" }
      : detectInAppBrowser(navigator.userAgent),
  );
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = useT();

  if (!isClient || !env.inApp || env.platform === "other" || dismissed) {
    return null;
  }

  const copyLink = async () => {
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for webviews without the async clipboard API. Must run
        // inside this user gesture for execCommand('copy') to be allowed.
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Copy blocked — the instruction text still tells them how to open it.
    }
  };

  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#ff3d3d]/35 bg-[#ff3d3d]/[0.08] px-3.5 py-3 text-left">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="mt-0.5 shrink-0 text-[#ff7a5e]"
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-snug text-white">
          {t.paywall.openInBrowserHeading}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-white/70">
          {env.platform === "android"
            ? t.paywall.openInBrowserAndroid
            : t.paywall.openInBrowserIos}
        </p>
        <div className="mt-2">
          {env.platform === "android" ? (
            <button
              type="button"
              onClick={() => {
                window.location.href = chromeIntentUrl();
              }}
              className="inline-flex h-8 items-center justify-center rounded-md bg-white px-3 text-[12px] font-bold text-black transition-colors hover:bg-white/90"
            >
              {t.paywall.openInBrowserAndroidCta}
            </button>
          ) : (
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-white px-3 text-[12px] font-bold text-black transition-colors hover:bg-white/90"
            >
              {copied ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
              {copied ? t.paywall.openInBrowserCopied : t.paywall.openInBrowserCopy}
            </button>
          )}
        </div>
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
