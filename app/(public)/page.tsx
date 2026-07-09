import { preconnect, prefetchDNS } from "react-dom";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";
import { ContinueWatchingRow } from "@/components/site/continue-watching-row";
import { HeroBanner } from "@/components/site/hero-banner";
import { JustReleasedRow } from "@/components/site/just-released-row";
import { MatioLogo } from "@/components/site/matio-logo";
import { TopThreeRow } from "@/components/site/top-three-row";
import { getContinueWatching } from "@/lib/continue-watching";
import { getPublishedShows } from "@/lib/catalog";
import { paymentsEnabled } from "@/lib/free-mode";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { getDict } from "@/lib/i18n/server";
import { catalogItemListJsonLd, jsonLdScript } from "@/lib/structured-data";
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

// First ready episode of the show's first season → muted hero preview
// (playback id + signed token when the asset uses a signed policy).
async function resolveHeroPreview(showId: string): Promise<{
  previewPlaybackId: string | null;
  previewToken: string | null;
}> {
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
        PREVIEW_TTL_SECONDS,
      );
    } catch {
      previewToken = null;
    }
  }
  return { previewPlaybackId: readyEp.muxPlaybackId, previewToken };
}

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

  if (published.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
        <div className="flex flex-col items-center gap-5">
          <MatioLogo size={26} />
          <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-gold/75">
            {t.home.comingSoonKicker}
          </p>
          <h1 className="font-display text-4xl uppercase leading-[1.0] tracking-[0.01em] text-cream sm:text-5xl">
            {t.home.storiesHeadline}
          </h1>
          <p className="max-w-sm text-sm text-cream/60">
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

  // The three remaining reads are independent — run them in parallel so a
  // warm request pays one Neon round-trip of latency, not three in series
  // (the page is force-dynamic; every visitor hits this path).
  const [[{ value: featuredEpisodeCount }], preview, continueWatching] =
    await Promise.all([
      // Ready-episode count for the featured hero's meta row. Cheap count
      // query — deliberately NOT folded into the cached catalog read (the
      // count only matters for the single featured show).
      db
        .select({ value: count() })
        .from(episodes)
        .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
        .where(
          and(eq(seasons.showId, featured.id), eq(episodes.status, "ready")),
        ),
      resolveHeroPreview(featured.id),
      getContinueWatching(),
    ]);
  const { previewPlaybackId, previewToken } = preview;

  // Top 3: shows flagged popularNow, falling back to the first 3 published
  // (createdAt desc) when fewer than 3 are flagged. Order stays stable.
  const popular = published.filter((s) => s.popularNow);
  const topThree = (popular.length >= 3 ? popular : published).slice(0, 3);

  // Just released: shows flagged justReleased, falling back to ALL published
  // so no show is orphaned when nothing is flagged.
  const flaggedNew = published.filter((s) => s.justReleased);
  const justReleased = flaggedNew.length > 0 ? flaggedNew : published;

  // Machine-readable catalog (ItemList of TVSeries stubs) — the entry point
  // AI answer engines read to learn what Matio offers. Organization + WebSite
  // come from the root layout; this adds the content layer.
  const catalogLd = catalogItemListJsonLd(
    published.map((s) => ({
      slug: s.slug,
      title: s.title,
      description: s.description,
      image: s.heroImageUrl ?? s.posterImageUrl,
    })),
  );

  return (
    <main className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(catalogLd) }}
      />
      <HeroBanner
        title={featured.title}
        description={featured.description}
        genre={featured.genre}
        slug={featured.slug}
        heroImageUrl={featured.heroImageUrl}
        posterImageUrl={featured.posterImageUrl}
        previewPlaybackId={previewPlaybackId}
        previewToken={previewToken}
        episodeCount={featuredEpisodeCount}
        // createdAt round-trips through unstable_cache as a string, not a Date.
        year={new Date(featured.createdAt).getFullYear()}
        paymentsOn={paymentsEnabled()}
      />

      <div className="flex flex-col gap-[34px] pt-[30px] pb-[76px] tablet:gap-10 tablet:pt-9 tablet:pb-[72px] xl:gap-[52px] xl:pt-11 xl:pb-[88px]">
        {continueWatching.length > 0 && (
          <ContinueWatchingRow items={continueWatching} />
        )}
        <TopThreeRow shows={topThree} />
        <JustReleasedRow shows={justReleased} />
      </div>
    </main>
  );
}
