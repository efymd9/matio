"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";

// Fires a Meta Pixel ViewContent for a show detail page. Rendered by the
// server component app/(public)/shows/[slug]/page.tsx, which can't call fbq
// directly. onPixelReady defers the fire until the consent-gated pixel has
// loaded (and never fires it at all without marketing consent).
export function ViewContentPixel({
  slug,
  title,
  genre,
}: {
  slug: string;
  title: string;
  genre?: string | null;
}) {
  useEffect(() => {
    return onPixelReady(() => {
      trackPixel("ViewContent", {
        content_type: "product",
        content_ids: [slug],
        content_name: title,
        ...(genre ? { content_category: genre } : {}),
      });
    });
  }, [slug, title, genre]);
  return null;
}
