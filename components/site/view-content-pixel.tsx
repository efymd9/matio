"use client";

import { useEffect } from "react";
import { capturePostHog, onPostHogReady } from "@/lib/posthog-events";

// Fires PostHog show_viewed for a show detail page. Rendered by the server
// component app/(public)/shows/[slug]/page.tsx, which can't call posthog
// directly. Deferred until the consent-gated SDK has loaded (never fires
// without marketing consent).
//
// The Meta ViewContent that used to fire here moved to the watch player's
// first playing frame (2026-06-10 funnel mapping: ViewContent = started
// watching) — ad traffic lands directly on /watch and never saw the show
// page, so the old placement missed the paid funnel entirely.
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
    return onPostHogReady(() => {
      capturePostHog("show_viewed", {
        show_slug: slug,
        show_title: title,
        ...(genre ? { genre } : {}),
      });
    });
  }, [slug, title, genre]);
  return null;
}
