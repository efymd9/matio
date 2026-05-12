import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows, type Show } from "@/db/schema";
import { GenreRow } from "@/components/site/genre-row";
import { HeroBanner } from "@/components/site/hero-banner";

const UNCATEGORIZED = "Uncategorized";

export default async function HomePage() {
  const published = await db
    .select()
    .from(shows)
    .where(and(eq(shows.status, "published"), isNull(shows.deletedAt)))
    .orderBy(asc(shows.title));

  if (published.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 pt-24 text-center">
        <div className="space-y-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-accent">
            Coming soon
          </p>
          <h1 className="font-display text-6xl italic leading-none">
            Stories worth your time.
          </h1>
          <p className="text-sm text-muted-foreground">
            The catalog is being curated. Check back shortly.
          </p>
        </div>
      </main>
    );
  }

  // Featured: admin pick wins, else first with a hero image, else first.
  const featured =
    published.find((s) => s.featured) ??
    published.find((s) => !!s.heroImageUrl) ??
    published[0];

  // Try to load a ready episode of the featured show for an auto-playing
  // preview. We use the public playback id directly — passing a signed
  // token to a public asset is a Mux error, so we let the hero attempt
  // playback without auth and fall back to the still image on any
  // failure (e.g. asset has signed-only policy).
  let previewPlaybackId: string | null = null;

  const featuredSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.showId, featured.id))
    .orderBy(asc(seasons.number))
    .limit(1);

  if (featuredSeasons.length > 0) {
    const [readyEp] = await db
      .select({ muxPlaybackId: episodes.muxPlaybackId })
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

    previewPlaybackId = readyEp?.muxPlaybackId ?? null;
  }

  // Group shows by genre (one show can appear in many rows).
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
      />

      <div className="mx-auto max-w-screen-2xl space-y-14 pt-10 sm:pt-14">
        {sortedGenres.map((g, i) => (
          <GenreRow
            key={g}
            genre={g}
            shows={byGenre.get(g)!}
            priority={i === 0}
          />
        ))}
      </div>
    </main>
  );
}
