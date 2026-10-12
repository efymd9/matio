"use client";

// Last-resort fallback for errors that escape app/error.tsx — typically
// crashes inside the root layout itself (Clerk provider, font loader,
// etc.). Must declare <html>/<body> because the root layout is what
// failed, so no other layout is wrapping us.
//
// English, like the rest of the site (#445) — the dictionary is imported
// directly, so nothing here depends on the layout that just failed.

import { useEffect } from "react";
import { en as t } from "@/lib/i18n/dictionaries";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
