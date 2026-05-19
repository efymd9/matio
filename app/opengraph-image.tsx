import { ImageResponse } from "next/og";

// Default OG image rendered at request time via next/og. 1200×630 is the
// canonical OG card size used by Twitter, Slack, iMessage, and LinkedIn.
// Per-show pages override this with their own OG via generateMetadata.

export const runtime = "edge";
export const alt = "matio — original stories, streamed";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(circle at 30% 25%, rgba(255,61,61,0.22), transparent 55%), #0d0d10",
          display: "flex",
          flexDirection: "column",
          padding: 96,
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 60,
          }}
        >
          {/* Matio mark — outlined circle + cinema-red disc */}
          <svg width="84" height="84" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11" stroke="white" strokeWidth="1.6" fill="none" />
            <circle cx="12" cy="12" r="4.5" fill="#ff3d3d" />
          </svg>
          <span style={{ fontSize: 64, fontWeight: 800, letterSpacing: "-0.04em" }}>
            matio
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            marginTop: "auto",
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "#ff3d3d",
            }}
          >
            Streaming originals
          </span>
          <span
            style={{
              fontSize: 84,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.035em",
              maxWidth: 980,
            }}
          >
            Original stories,
            <br />
            streamed.
          </span>
          <span style={{ fontSize: 26, color: "rgba(255,255,255,0.65)", marginTop: 12 }}>
            Watch the first 60 seconds free.
          </span>
        </div>
      </div>
    ),
    size,
  );
}
