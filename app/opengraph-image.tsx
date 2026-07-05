import { ImageResponse } from "next/og";
import { paymentsEnabled } from "@/lib/free-mode";
import { en } from "@/lib/i18n/dictionaries";

// Default OG image rendered at request time via next/og. 1200×630 is the
// canonical OG card size used by Twitter, Slack, iMessage, and LinkedIn.
// Per-show pages override this with their own OG via generateMetadata.
//
// Social-media crawlers don't carry our locale cookie, so the OG renders
// in the site's default locale (English). Per-show OGs still surface the
// show's own title/description verbatim from the database.

export const runtime = "edge";
export const alt = en.metadata.siteTitle;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Edge runtime has no filesystem access — fetch the bundled asset by URL
// (next/og inlines files reachable from import.meta.url into the edge
// function) and inline it as a data URI for Satori's <img>. Memoized at
// module scope: the ~500KB fetch + base64 encode runs once per isolate,
// not once per crawler request.
let wordmarkSrcPromise: Promise<string> | null = null;
function getWordmarkSrc(): Promise<string> {
  wordmarkSrcPromise ??= fetch(
    new URL("../public/brand/matio-wordmark.png", import.meta.url),
  )
    .then((res) => res.arrayBuffer())
    .then(
      (buf) => `data:image/png;base64,${Buffer.from(buf).toString("base64")}`,
    );
  return wordmarkSrcPromise;
}

export default async function OpenGraphImage() {
  const wordmarkSrc = await getWordmarkSrc();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#0f0a07",
          display: "flex",
          flexDirection: "column",
          padding: 96,
          color: "#f6efe4",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* Soft gold glow, upper-left; burgundy ambient glow off the floor. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 24% 20%, rgba(230,179,102,0.15), transparent 55%), radial-gradient(ellipse at 50% 115%, rgba(143,47,28,0.45), transparent 55%)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            position: "relative",
          }}
        >
          { }
          <img src={wordmarkSrc} width={260} height={125} alt="" />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            marginTop: "auto",
            position: "relative",
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "#e6b366",
            }}
          >
            {en.og.kicker}
          </span>
          <span
            style={{
              fontSize: 84,
              fontWeight: 800,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              maxWidth: 980,
              color: "#f6efe4",
            }}
          >
            {en.og.title[0]}
            <br />
            {en.og.title[1]}
          </span>
          <span style={{ fontSize: 26, color: "rgba(246,239,228,0.7)", marginTop: 12 }}>
            {paymentsEnabled() ? en.og.tagline : en.og.taglineFree}
          </span>
        </div>
      </div>
    ),
    size,
  );
}
