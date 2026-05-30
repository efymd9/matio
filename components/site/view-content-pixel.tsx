"use client";

import { useEffect } from "react";
import { onPixelReady, trackPixel } from "@/lib/meta-pixel-events";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires a Meta Pixel ViewContent + PostHog show_viewed for a show detail page.
// Rendered by the server component app/(public)/shows/[slug]/page.tsx, which
// can't call fbq/posthog directly. Both fires are deferred until their
// consent-gated SDK has loaded (and never fire at all without marketing
// consent).
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
    const offPixel = onPixelReady(() => {
      trackPixel("ViewContent", {
        content_type: "product",
        content_ids: [slug],
        content_name: title,
        ...(genre ? { content_category: genre } : {}),
      });
    });
    const offPostHog = onPostHogReady(() => {
      capturePostHog("show_viewed", {
        show_slug: slug,
        show_title: title,
        ...(genre ? { genre } : {}),
      });
    });
    return () => {
      offPixel();
      offPostHog();
    };
  }, [slug, title, genre]);
  return null;
}
