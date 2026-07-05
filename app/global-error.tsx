"use client";

// Last-resort fallback for errors that escape app/error.tsx — typically
// crashes inside the root layout itself (Clerk provider, font loader,
// etc.). Must declare <html>/<body> because the root layout is what
// failed, so no other layout is wrapping us.
//
// The LocaleProvider lives inside the failed root layout, so we can't
// useT() here. Instead we read the locale cookie directly off
// document.cookie via useSyncExternalStore (SSR-safe; returns the
// default locale on the server) and pluck the right dict from there.
// With no cookie we fall back to navigator.languages — the client-side
// mirror of the Accept-Language detection getLocale() does on the server
// (lib/i18n/negotiate.ts) — so a detected-ES visitor doesn't get an
// English crash screen. Geo isn't available client-side; default copy is
// fine for that sliver.

import { useEffect, useSyncExternalStore } from "react";
import { dictFor, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/dictionaries";
import { pickFromLanguageTags } from "@/lib/i18n/negotiate";

const LOCALE_COOKIE = "locale";

function readClientLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`),
  );
  const value = match?.[1];
  if (value === "en" || value === "es") return value;
  return (
    pickFromLanguageTags(
      typeof navigator !== "undefined" ? navigator.languages ?? [] : [],
    ) ?? DEFAULT_LOCALE
  );
}

const subscribe = () => () => {};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useSyncExternalStore(
    subscribe,
    readClientLocale,
    () => DEFAULT_LOCALE,
  );
  const t = dictFor(locale);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={t.htmlLang}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f0a07",
          color: "#f6efe4",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            style={{ marginBottom: 20 }}
          >
            <circle cx="12" cy="12" r="11" stroke="#f6efe4" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4.5" fill="#a8401f" />
          </svg>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#a8401f",
              marginBottom: 18,
            }}
          >
            {t.globalError.kicker}
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, lineHeight: 1 }}>
            {t.globalError.title}
          </h1>
          <p style={{ marginTop: 16, color: "rgba(246,239,228,0.55)", fontSize: 14 }}>
            {t.globalError.body}
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 16,
                fontFamily: "monospace",
                fontSize: 10,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(246,239,228,0.35)",
              }}
            >
              {t.globalError.refLabel} · {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 28,
              height: 44,
              padding: "0 24px",
              borderRadius: 8,
              border: "none",
              background: "#ffffff",
              color: "#000000",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {t.globalError.tryAgain}
          </button>
        </div>
      </body>
    </html>
  );
}
