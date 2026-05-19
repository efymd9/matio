import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { GenreRow } from "@/components/site/genre-row";
import { HeroBanner } from "@/components/site/hero-banner";
import { MatioLogo } from "@/components/site/matio-logo";
import { signMuxPlaybackToken } from "@/lib/mux-token";
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
  // One published-shows query, partitioned in JS into the two homepage
  // sections. A show can be in both, either, or neither — neither hides it
  // from / but it stays reachable at /shows/[slug].
  const published = await db
    .select()
    .from(shows)
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)))
    .orderBy(desc(shows.createdAt));

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
            Coming soon
          </p>
          <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tight text-white">
            Stories worth your time.
          </h1>
          <p className="text-sm text-white/60">
            The catalog is being curated. Check back shortly.
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
    { key: "just-released", label: "Just released", shows: justReleased, size: "big" as const },
    { key: "popular-now", label: "Popular now", shows: popularNow, size: "big" as const },
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
