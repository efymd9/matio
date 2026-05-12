import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";

export default async function ShowDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [show] = await db
    .select()
    .from(shows)
    .where(
      and(
        eq(shows.slug, slug),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);
  if (!show) notFound();

  const showSeasons = await db
    .select()
    .from(seasons)
    .where(eq(seasons.showId, show.id))
    .orderBy(asc(seasons.number));

  const seasonIds = showSeasons.map((s) => s.id);
  const allEpisodes =
    seasonIds.length === 0
      ? []
      : await db
          .select()
          .from(episodes)
          .where(inArray(episodes.seasonId, seasonIds))
          .orderBy(asc(episodes.number));

  const episodesBySeason = new Map<string, typeof allEpisodes>();
  for (const e of allEpisodes) {
    const list = episodesBySeason.get(e.seasonId) ?? [];
    list.push(e);
    episodesBySeason.set(e.seasonId, list);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-8">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Home
      </Link>

      <header className="grid gap-6 sm:grid-cols-[200px_1fr]">
        <div className="aspect-[2/3] overflow-hidden rounded-md bg-muted">
          {show.posterImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={show.posterImageUrl}
              alt={show.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
              {show.title}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold">{show.title}</h1>
          {show.genre.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {show.genre.join(" · ")}
            </p>
          )}
          {show.description && (
            <p className="leading-relaxed">{show.description}</p>
          )}
        </div>
      </header>

      <div className="space-y-6">
        {showSeasons.length === 0 && (
          <p className="text-muted-foreground">No seasons yet.</p>
        )}
        {showSeasons.map((season) => {
          const eps = episodesBySeason.get(season.id) ?? [];
          return (
            <section key={season.id} className="space-y-3">
              <h2 className="text-xl font-semibold">
                Season {season.number}
                {season.title && (
                  <span className="ml-2 text-muted-foreground">
                    — {season.title}
                  </span>
                )}
              </h2>
              {eps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No episodes yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {eps.map((ep) => {
                    const playable = !!ep.muxPlaybackId && ep.status === "ready";
                    return (
                      <li
                        key={ep.id}
                        className="flex items-start gap-4 py-3"
                      >
                        <div className="w-8 text-sm font-medium text-muted-foreground">
                          {ep.number}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{ep.title}</div>
                          {ep.description && (
                            <div className="text-sm text-muted-foreground">
                              {ep.description}
                            </div>
                          )}
                          {ep.durationSeconds && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {Math.floor(ep.durationSeconds / 60)}m{" "}
                              {ep.durationSeconds % 60}s
                            </div>
                          )}
                        </div>
                        {playable ? (
                          <Link
                            href={`/watch/${show.slug}`}
                            className={buttonVariants({ size: "sm" })}
                          >
                            Play
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Coming soon
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
