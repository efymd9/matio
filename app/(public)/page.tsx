import { preconnect, prefetchDNS } from "react-dom";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import { GenreRow } from "@/components/site/genre-row";
import { HeroBanner } from "@/components/site/hero-banner";
import { MatioLogo } from "@/components/site/matio-logo";
import { getPublishedShows } from "@/lib/catalog";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { getDict } from "@/lib/i18n/server";
import { TRIAL_DURATION_SECONDS } from "@/lib/trial";
// The hero auto-plays a muted preview of the featured show's first episode.
// The signed JWT we mint here ends up in the HTML, so anyone can extract it
// and stream the asset directly. Cap the TTL to the trial duration so the
// preview window never exposes more than what /watch already gives an
// anonymous visitor for free. (Defense-in-depth: also configure referrer
// restrictions on the Mux signing key — see docs/services.md.)
const PREVIEW_TTL_SECONDS = TRIAL_DURATION_SECONDS;

// Force dynamic rendering. The hero embeds a 60s Mux JWT in the HTML — if
// the page were prerendered at build time (Next 16's default for pure DB
// reads) or CDN-cached for more than ~60s, the JWT would be dead on arrival
// for almost every visitor. Each request must mint a fresh token.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { t } = await getDict();
  // Warm the cross-origin thumbnail/preview host (DNS+TLS) before the ~350KB
  // hero player chunk loads — the handshake otherwise sits on the LCP path.
  // crossOrigin "anonymous" matches how next/image fetches, so this reuses the
  // same connection instead of opening a second. (Metadata API has no
  // <link rel=preconnect>; React's resource-hint APIs are the Next 16 way.)
  preconnect("https://image.mux.com", { crossOrigin: "anonymous" });
  prefetchDNS("https://image.mux.com");
  // Cached published-shows read. lib/catalog.ts wraps the query in
  // unstable_cache with tag CATALOG_TAG; admin mutations bust the tag.
  // Page is still force-dynamic for the hero JWT — only the catalog
  // query is cached, not the page itself.
  const published = await getPublishedShows();

  const justReleased = published.filter((s) => s.justReleased);
  const popularNow = published.filter((s) => s.popularNow);

  if (published.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 pt-24 text-center">
        <div className="space-y-5">
          <div className="flex justify-center">
            <MatioLogo size={32} accent="#ff3d3d" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-[#ff3d3d]">
            {t.home.comingSoonKicker}
          </p>
          <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tight text-white">
            {t.home.storiesHeadline}
          </h1>
          <p className="text-sm text-white/60">
            {t.home.catalogBeingCurated}
          </p>
        </div>
      </main>
    );
  }

  const featured =
    published.find((s) => s.featured) ??
    published.find((s) => !!s.heroImageUrl) ??
    published[0];

  let previewPlaybackId: string | null = null;
  let previewToken: string | null = null;

  const featuredSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.showId, featured.id))
    .orderBy(asc(seasons.number))
    .limit(1);

  if (featuredSeasons.length > 0) {
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
        ),
      )
      .orderBy(asc(episodes.number))
      .limit(1);

    if (readyEp?.muxPlaybackId) {
      previewPlaybackId = readyEp.muxPlaybackId;
      if (readyEp.muxPlaybackPolicy === "signed") {
        try {
          previewToken = signMuxPlaybackToken(
            readyEp.muxPlaybackId,
            PREVIEW_TTL_SECONDS,
          );
        } catch {
          previewToken = null;
        }
      }
    }
  }

  const sections: Array<{
    key: string;
    label: string;
    shows: typeof published;
    size: "default" | "big";
  }> = [
    { key: "just-released", label: t.home.justReleased, shows: justReleased, size: "big" as const },
    { key: "popular-now", label: t.home.popularNow, shows: popularNow, size: "big" as const },
  ].filter((s) => s.shows.length > 0);

  return (
    <main className="bg-background pb-24">
      <HeroBanner
        title={featured.title}
        description={featured.description}
        genre={featured.genre}
        slug={featured.slug}
        heroImageUrl={featured.heroImageUrl}
        posterImageUrl={featured.posterImageUrl}
        previewPlaybackId={previewPlaybackId}
        previewToken={previewToken}
      />

      <div className="mx-auto max-w-screen-2xl space-y-10 pt-8 sm:pt-10">
        {sections.map((section, i) => (
          <div
            key={section.key}
            id={`row-${section.key}`}
            className="scroll-mt-24"
          >
            <GenreRow
              genre={section.label}
              shows={section.shows}
              priority={i === 0}
              size={section.size}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
