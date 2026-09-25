// Resized show artwork for the mobile app (#292 item 10): the app draws a
// poster 148pt wide, but /api/v1 hands it the ORIGINAL — a 2–3 MB PNG, or a
// Blob upload of up to 15 MB — because the web resizes through next/image and
// the wire contract just passes the stored URL on. This builds the same
// optimizer URL next/image would, so the app fetches a WebP of the width it
// draws instead.
//
// UNIVERSAL — imported by the app through Metro (mobile/src/shared/
// image-url.ts). No `server-only`, no next/*: lib/seo.ts is dependency-free.

import { SITE_URL } from "../seo";

// The widths /_next/image accepts: Next's defaults (`imageSizes` then
// `deviceSizes` of imageConfigDefault — next.config.ts sets neither). Any
// other `w` is a 400, so every URL built here snaps to this list. Pinned
// against the installed Next and our config by image-url.test.ts.
export const OPTIMIZER_WIDTHS = [
  32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840,
] as const;

// Next 16 allows exactly one quality by default (`qualities: [75]`).
export const OPTIMIZER_QUALITY = 75;

// A URL on the Blob store (`https://<storeId>.public.blob.vercel-storage.com/…`)
// — the remotePattern in next.config.ts, and the only remote host show
// artwork lives on. Plain string rules rather than `new URL`: nothing here
// needs more, and the app's runtime then needs nothing either.
const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

// The smallest allowed width that covers `px` device pixels; past the
// largest, the largest.
export function snapImageWidth(px: number): number {
  for (const w of OPTIMIZER_WIDTHS) {
    if (w >= px) return w;
  }
  return OPTIMIZER_WIDTHS[OPTIMIZER_WIDTHS.length - 1];
}

// The optimizer's `url` parameter for an artwork URL, or null when the
// optimizer must not see it:
//   - a same-origin path ("/shows/x.png") — or the absolute form /api/v1
//     turns it into (absoluteMediaUrl) — goes as the PATH: the optimizer
//     reads local images from its own deployment, and matio.tv is not a
//     remotePattern, so the absolute form would be refused;
//   - a Blob URL goes as itself (remotePatterns allows it);
//   - anything else (a signed Mux thumbnail, an unknown host) is left alone.
function optimizerSource(src: string): string | null {
  if (src.startsWith("/") && !src.startsWith("//")) return src;
  if (src.startsWith(`${SITE_URL}/`)) return src.slice(SITE_URL.length);
  if (BLOB_URL.test(src)) return src;
  return null;
}

// `widthPx` is the width the image is DRAWN at, in device pixels (points ×
// pixel ratio). A source the optimizer cannot take comes back unchanged.
export function optimizedImageUrl(src: string | null, widthPx: number): string | null {
  if (!src) return null;
  const source = optimizerSource(src);
  if (source === null) return src;
  const params = `url=${encodeURIComponent(source)}&w=${snapImageWidth(widthPx)}&q=${OPTIMIZER_QUALITY}`;
  return `${SITE_URL}/_next/image?${params}`;
}
