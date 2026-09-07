import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { TRIAL_DURATION_SECONDS } from "@/lib/trial";

// The hero on `/` auto-plays a muted preview of the featured show's first
// episode. The signed JWT we mint ends up in the HTML (and in the answer of
// /api/hero-preview-token), so anyone can extract it and stream the asset
// directly. Cap the TTL to the trial duration so the preview window never
// exposes more than what /watch already gives an anonymous visitor for free.
// (Defense-in-depth: also configure referrer restrictions on the Mux signing
// key — see docs/services.md.)
export const HERO_PREVIEW_TTL_SECONDS = TRIAL_DURATION_SECONDS;

export type HeroPreview = {
  previewPlaybackId: string | null;
  previewToken: string | null;
};

// Featured show = the admin-flagged one, else the first with hero artwork,
// else the newest published. One rule for the page AND the token route, so a
// re-minted token is always for the show the page actually rendered.
export function pickFeaturedShow<
  T extends { featured: boolean; heroImageUrl: string | null },
>(published: T[]): T | undefined {
  return (
    published.find((s) => s.featured) ??
    published.find((s) => !!s.heroImageUrl) ??
    published[0]
  );
}

// First ready episode of the show's first season → muted hero preview
// (playback id + signed token when the asset uses a signed policy).
export async function resolveHeroPreview(showId: string): Promise<HeroPreview> {
  const featuredSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.showId, showId))
    .orderBy(asc(seasons.number))
    .limit(1);
  if (featuredSeasons.length === 0) {
    return { previewPlaybackId: null, previewToken: null };
  }

  const [readyEp] = await db
    .select({
      muxPlaybackId: episodes.muxPlaybackId,
      muxPlaybackPolicy: episodes.muxPlaybackPolicy,
    })
    .from(episodes)
    .where(
      and(
        inArray(
          episodes.seasonId,
          featuredSeasons.map((s) => s.id),
        ),
        eq(episodes.status, "ready"),
        // "First episode" means first LISTED episode — never a branch (#143).
        isNull(episodes.branchOfEpisodeId),
      ),
    )
    .orderBy(asc(episodes.number))
    .limit(1);

  if (!readyEp?.muxPlaybackId) {
    return { previewPlaybackId: null, previewToken: null };
  }
  let previewToken: string | null = null;
  if (readyEp.muxPlaybackPolicy === "signed") {
    try {
      previewToken = signMuxPlaybackToken(
        readyEp.muxPlaybackId,
        HERO_PREVIEW_TTL_SECONDS,
      );
    } catch {
      previewToken = null;
    }
  }
  return { previewPlaybackId: readyEp.muxPlaybackId, previewToken };
}
