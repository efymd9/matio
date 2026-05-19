"use client";

// Last-resort fallback for errors that escape app/error.tsx — typically
// crashes inside the root layout itself (Clerk provider, font loader,
// etc.). Must declare <html>/<body> because the root layout is what
// failed, so no other layout is wrapping us.

import { useEffect } from "react";

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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0d0d10",
          color: "#ffffff",
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
            <circle cx="12" cy="12" r="11" stroke="#ffffff" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="4.5" fill="#ff3d3d" />
          </svg>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#ff3d3d",
              marginBottom: 18,
            }}
          >
            Something glitched
          </p>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, lineHeight: 1 }}>
            We&apos;ll catch the next take.
          </h1>
          <p style={{ marginTop: 16, color: "rgba(255,255,255,0.55)", fontSize: 14 }}>
            The root layout failed to render. Refresh, or try again in a moment.
          </p>
          {error.digest && (
            <p
              style={{
                marginTop: 16,
                fontFamily: "monospace",
                fontSize: 10,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
              }}
            >
              ref · {error.digest}
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
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
