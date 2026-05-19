import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows, type Show } from "@/db/schema";
import { GenreRow } from "@/components/site/genre-row";
import { HeroBanner } from "@/components/site/hero-banner";
import { MatioLogo } from "@/components/site/matio-logo";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { TRIAL_DURATION_SECONDS } from "@/lib/trial";

const UNCATEGORIZED = "Uncategorized";
// The hero auto-plays a muted preview of the featured show's first episode.
// The signed JWT we mint here ends up in the HTML, so anyone can extract it
// and stream the asset directly. Cap the TTL to the trial duration so the
// preview window never exposes more than what /watch already gives an
// anonymous visitor for free. (Defense-in-depth: also configure referrer
// restrictions on the Mux signing key — see docs/services.md.)
const PREVIEW_TTL_SECONDS = TRIAL_DURATION_SECONDS;

export default async function HomePage() {
  const published = await db
    .select()
    .from(shows)
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)))
    .orderBy(asc(shows.title));

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

  const byGenre = new Map<string, Show[]>();
  for (const show of published) {
    const genres = show.genre.length > 0 ? show.genre : [UNCATEGORIZED];
    for (const g of genres) {
      const list = byGenre.get(g) ?? [];
      list.push(show);
      byGenre.set(g, list);
    }
  }
  const sortedGenres = [...byGenre.keys()].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  });

  const categoryChips = sortedGenres.slice(0, 5);

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

      {/* Category chips strip — sits at the top of the rows section, mirrors
          the floating chips on the iOS hero in the design. */}
      {categoryChips.length > 0 && (
        <div className="scrollbar-hidden overflow-x-auto border-b border-white/[0.05]">
          <div className="mx-auto flex max-w-screen-2xl gap-2 px-6 py-4 sm:px-12">
            {categoryChips.map((g) => (
              <a
                key={g}
                href={`#row-${slugify(g)}`}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 text-xs font-medium text-white/85 backdrop-blur-xl transition-colors hover:bg-white/15 capitalize"
              >
                {g}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-screen-2xl space-y-10 pt-8 sm:pt-10">
        {sortedGenres.map((g, i) => (
          <div key={g} id={`row-${slugify(g)}`} className="scroll-mt-24">
            <GenreRow
              genre={g}
              shows={byGenre.get(g)!}
              priority={i === 0}
              size={i === 1 ? "big" : "default"}
            />
          </div>
        ))}
      </div>
    </main>
  );
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
