import { ImageResponse } from "next/og";
import { getShowBySlug } from "@/lib/show-query";
import { en } from "@/lib/i18n/dictionaries";

// Per-show OG card: the show title over its hero art (when public), with the
// Matio mark — a branded, correctly-sized 1200×630 unfurl. This file
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

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const show = await getShowBySlug(slug);
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
          background: "#0a0a0c",
          color: "white",
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
        {/* Legibility gradient — darker when there's a photo behind the text. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: background
              ? "linear-gradient(180deg, rgba(10,10,12,0.15) 0%, rgba(10,10,12,0.55) 55%, rgba(10,10,12,0.95) 100%)"
              : "radial-gradient(circle at 28% 22%, rgba(255,61,61,0.24), transparent 58%)",
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
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" stroke="white" strokeWidth="1.6" fill="none" />
              <circle cx="12" cy="12" r="4.5" fill="#ff3d3d" />
            </svg>
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em" }}>
              matio
            </span>
          </div>
          <span
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: "-0.035em",
              maxWidth: 1040,
            }}
          >
            {title}
          </span>
          {genre ? (
            <span
              style={{
                fontSize: 26,
                color: "rgba(255,255,255,0.72)",
                textTransform: "capitalize",
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
