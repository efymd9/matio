import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { Player } from "@/components/watch/player";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ episodeId: string }>;
}) {
  const { episodeId } = await params;

  const [row] = await db
    .select({
      episode: episodes,
      season: seasons,
      show: shows,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const { episode, season, show } = row;
  const playable = !!episode.muxPlaybackId && episode.status === "ready";

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <Link
        href={`/shows/${show.slug}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {show.title}
      </Link>

      <h1 className="text-xl font-semibold">
        S{season.number}E{episode.number} · {episode.title}
      </h1>

      {playable ? (
        <Player
          episodeId={episode.id}
          playbackId={episode.muxPlaybackId!}
          title={episode.title}
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
          Video is being processed. Check back shortly.
        </div>
      )}

      {episode.description && (
        <p className="leading-relaxed">{episode.description}</p>
      )}
    </div>
  );
}
