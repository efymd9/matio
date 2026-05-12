import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows, type Episode } from "@/db/schema";

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

  const episodesBySeason = new Map<string, Episode[]>();
  for (const e of allEpisodes) {
    const list = episodesBySeason.get(e.seasonId) ?? [];
    list.push(e);
    episodesBySeason.set(e.seasonId, list);
  }

  const totalEpisodes = allEpisodes.filter((e) => e.status === "ready").length;
  const backdrop = show.heroImageUrl ?? show.posterImageUrl;

  return (
    <main className="bg-background">
      {/* Hero */}
      <section className="relative isolate h-[70vh] min-h-[520px] w-full overflow-hidden">
        {backdrop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={backdrop}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-muted via-card to-background" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/65 to-background/15" />
        <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-background/85 via-background/40 to-transparent" />

        <div className="relative z-10 flex h-full flex-col justify-end px-6 pb-14 pt-32 sm:px-12 sm:pb-20 sm:pt-36">
          <div className="max-w-3xl space-y-5">
            {show.genre.length > 0 && (
              <p className="text-[10px] font-medium uppercase tracking-[0.4em] text-accent">
                {show.genre.join("  ·  ")}
              </p>
            )}
            <h1 className="font-display text-5xl italic leading-[0.95] tracking-tight sm:text-7xl lg:text-8xl">
              {show.title}
            </h1>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {totalEpisodes > 0 && (
                <span>
                  {totalEpisodes}{" "}
                  {totalEpisodes === 1 ? "episode" : "episodes"}
                </span>
              )}
              {showSeasons.length > 0 && (
                <>
                  <span aria-hidden>•</span>
                  <span>
                    {showSeasons.length}{" "}
                    {showSeasons.length === 1 ? "season" : "seasons"}
                  </span>
                </>
              )}
            </div>
            {show.description && (
              <p className="max-w-2xl text-base leading-relaxed text-foreground/85 sm:text-lg">
                {show.description}
              </p>
            )}
            {totalEpisodes > 0 && (
              <div className="pt-2">
                <Link
                  href={`/watch/${show.slug}`}
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-8 text-sm font-medium text-background transition-all duration-300 hover:bg-accent hover:text-accent-foreground"
                >
                  <PlayGlyph />
                  Watch
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Episodes */}
      <section className="mx-auto max-w-5xl px-6 py-16 sm:px-12 sm:py-20">
        {showSeasons.length === 0 ? (
          <div className="text-center">
            <p className="font-display text-3xl italic text-muted-foreground">
              No episodes yet
            </p>
          </div>
        ) : (
          <div className="space-y-16">
            {showSeasons.map((season) => {
              const eps = episodesBySeason.get(season.id) ?? [];
              return (
                <div key={season.id} className="space-y-6">
                  <div className="flex items-baseline gap-3 border-b border-border/60 pb-3">
                    <h2 className="font-display text-3xl italic leading-none text-foreground/90">
                      Season {season.number}
                    </h2>
                    {season.title && (
                      <span className="text-sm text-muted-foreground">
                        {season.title}
                      </span>
                    )}
                  </div>
                  {eps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No episodes yet.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {eps.map((ep) => (
                        <EpisodeRow
                          key={ep.id}
                          ep={ep}
                          showSlug={show.slug}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function EpisodeRow({
  ep,
  showSlug,
}: {
  ep: Episode;
  showSlug: string;
}) {
  const playable = !!ep.muxPlaybackId && ep.status === "ready";
  const minutes = ep.durationSeconds
    ? Math.floor(ep.durationSeconds / 60)
    : null;

  return (
    <li className="group relative">
      <Link
        href={playable ? `/watch/${showSlug}` : "#"}
        aria-disabled={!playable}
        tabIndex={playable ? 0 : -1}
        className={`flex items-center gap-6 py-6 transition-colors ${
          playable
            ? "hover:bg-muted/30 focus-visible:bg-muted/30"
            : "cursor-default"
        } -mx-4 rounded-md px-4`}
      >
        <div
          className={`font-display text-4xl italic leading-none transition-colors duration-300 ${
            playable
              ? "text-muted-foreground/40 group-hover:text-accent"
              : "text-muted-foreground/30"
          }`}
        >
          {String(ep.number).padStart(2, "0")}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <h3 className="text-base font-medium text-foreground sm:text-lg">
            {ep.title}
          </h3>
          {ep.description && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {ep.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70">
            {minutes && <span>{minutes} min</span>}
            {!playable && (
              <span className="text-accent/80">Coming soon</span>
            )}
          </div>
        </div>
        {playable && (
          <div className="hidden shrink-0 items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-foreground/70 transition-all duration-300 group-hover:gap-3 group-hover:text-foreground sm:flex">
            Play
            <span className="text-accent">→</span>
          </div>
        )}
      </Link>
    </li>
  );
}

function PlayGlyph() {
  return (
    <svg
      width="11"
      height="13"
      viewBox="0 0 11 13"
      fill="currentColor"
      aria-hidden
    >
      <path d="M0 0L11 6.5L0 13V0Z" />
    </svg>
  );
}
