import { NextResponse } from "next/server";
import { getPublishedShows } from "@/lib/catalog";
import { pickFeaturedShow, resolveHeroPreview } from "@/lib/hero-preview";

// GET /api/hero-preview-token — a fresh preview token for the home hero.
//
// The token the page embeds lives HERO_PREVIEW_TTL_SECONDS (60s), but the
// teaser loops for as long as the visitor stays on `/`; once the stream dies
// of an expired token the player asks here for the next one and remounts
// (components/site/hero-banner.tsx, issue #128). The answer is exactly what a
// plain GET / already puts in the HTML for every anonymous visitor — the same
// featured show, the same first episode, the same TTL — so this is no new
// exposure. Nothing comes from the request: the playback id is resolved from
// the catalog server-side, and the client only accepts a token whose playback
// id matches the one it is already playing.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const featured = pickFeaturedShow(await getPublishedShows());
  const preview = featured ? await resolveHeroPreview(featured.id) : null;
  if (!preview?.previewPlaybackId) {
    return NextResponse.json(
      { error: "no_preview" },
      { status: 404, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { playbackId: preview.previewPlaybackId, token: preview.previewToken },
    { headers: NO_STORE },
  );
}
