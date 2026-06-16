// Pure in-app-browser (webview) detection from a User-Agent string. NO
// "use server" / "server-only" — it's imported BOTH server-side (the watch /
// checkout request `user-agent` header) AND client-side (navigator.userAgent in
// the open-in-browser hint), so it must stay a plain, universal module.
//
// Funnel finding (2026-06): ~60% of ad traffic lands in the Facebook/Instagram
// in-app browser (WKWebView on iOS, System WebView on Android). Those webviews
// break the post-payment account flow in three independent ways:
//   (a) Google OAuth is hard-blocked there (Google returns `disallowed_useragent`);
//   (b) the httpOnly `checkout_claim` cookie is routinely dropped across the
//       Stripe round-trip, so /welcome can't prove "this browser paid";
//   (c) the Embedded Checkout iframe (js.stripe.com) + Apple/Google Pay are flaky
//       vs. a full hosted page.
// So we detect them to (1) route checkout to HOSTED Stripe instead of the
// embedded iframe and (2) surface a prominent "open in your real browser" escape
// before/after checkout. See components/watch/open-in-browser-hint.tsx and the
// checkout actions.

export type InAppPlatform = "ios" | "android" | "other";
export type InAppBrowserEnv = { inApp: boolean; platform: InAppPlatform };

// The Meta webviews carry these UA tokens on BOTH platforms — the Android FB
// webview reports FB_IAB/FB4A even though it otherwise shares Chrome's UA;
// Instagram's webview carries the `Instagram` token. (Kept in sync with the
// trial bot-supplement list's spirit: a deliberately small, high-precision set.)
const IN_APP_RE = /FBAN|FBAV|FB_IAB|FB4A|Instagram/i;

export function detectInAppBrowser(
  ua: string | null | undefined,
): InAppBrowserEnv {
  const s = ua ?? "";
  const inApp = IN_APP_RE.test(s);
  const platform: InAppPlatform = /iPhone|iPad|iPod/i.test(s)
    ? "ios"
    : /Android/i.test(s)
      ? "android"
      : "other";
  return { inApp, platform };
}

export function isInAppBrowser(ua: string | null | undefined): boolean {
  return IN_APP_RE.test(ua ?? "");
}
