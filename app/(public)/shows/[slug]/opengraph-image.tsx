import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getShowBySlug } from "@/lib/show-query";
import { en } from "@/lib/i18n/dictionaries";

// Per-show OG card: the show title over its hero art (when public), with the
// Matio wordmark — a branded, correctly-sized 1200×630 unfurl. This file
// convention auto-wires og:image + twitter:image, so the show page's
// generateMetadata deliberately sets NO images (avoids a double og:image).
//
// Node runtime (not edge): getShowBySlug reads via the postgres-js driver,
// which needs Node TCP sockets. ImageResponse works in both runtimes.
export const runtime = "nodejs";

export const alt = en.metadata.siteTitle;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Only public hosts are safe as a crawler-facing background: signed Mux
// thumbnails 403, and arbitrary hosts aren't in the next/image allowlist.
const PUBLIC_BLOB = ".public.blob.vercel-storage.com";

function publicArt(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes(PUBLIC_BLOB)) return url;
  // Legacy same-origin /shows/*.png artwork is also public.
  if (url.startsWith("https://matio.tv/")) return url;
  return null;
}

// Memoized at module scope — the wordmark read + base64 encode (~500KB)
// runs once per server process, not once per show-page unfurl.
let wordmarkSrcPromise: Promise<string> | null = null;
function getWordmarkSrc(): Promise<string> {
  wordmarkSrcPromise ??= readFile(
    path.join(process.cwd(), "public/brand/matio-wordmark.png"),
  ).then((buf) => `data:image/png;base64,${buf.toString("base64")}`);
  return wordmarkSrcPromise;
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [show, wordmarkSrc] = await Promise.all([
    getShowBySlug(slug),
    getWordmarkSrc(),
  ]);
  const title = show?.title ?? "matio";
  const background = publicArt(show?.heroImageUrl) ?? publicArt(show?.posterImageUrl);
  const genre = (show?.genre ?? []).slice(0, 3).join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          background: "#0f0a07",
          color: "#f6efe4",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {background ? (
           
          <img
            src={background}
            alt=""
            width={1200}
            height={630}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : null}
        {/* Duotone tint over the artwork — Satori has no mix-blend-mode
            support, so this is a flat gradient at reduced opacity standing
            in for the site's .duotone overlay, not a true blend. */}
        {background ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(160deg, rgba(230,179,102,0.2), rgba(143,47,28,0.3))",
            }}
          />
        ) : null}
        {/* Legibility scrim to espresso — darker when there's a photo behind the text. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: background
              ? "linear-gradient(180deg, rgba(15,10,7,0.15) 0%, rgba(15,10,7,0.6) 55%, rgba(15,10,7,0.97) 100%)"
              : "radial-gradient(circle at 26% 20%, rgba(230,179,102,0.16), transparent 55%), radial-gradient(ellipse at 50% 115%, rgba(143,47,28,0.45), transparent 55%)",
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            padding: 80,
            gap: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            { }
            <img src={wordmarkSrc} width={144} height={69} alt="" />
          </div>
          <span
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              maxWidth: 1040,
              color: "#f6efe4",
            }}
          >
            {title}
          </span>
          {genre ? (
            <span
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: "rgba(230,179,102,0.7)",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              {genre}
            </span>
          ) : null}
        </div>
      </div>
    ),
    size,
  );
}
