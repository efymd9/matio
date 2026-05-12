import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows, subscriptions } from "@/db/schema";
import { Player } from "@/components/watch/player";
import { WatchShell } from "@/components/watch/watch-shell";
import {
  TRIAL_COOKIE,
  getOrCreateTrialSession,
  isTrialActive,
} from "@/lib/trial";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ showSlug: string }>;
  searchParams: Promise<{ resume?: string }>;
}) {
  const { showSlug } = await params;
  const { resume } = await searchParams;
  const resumeSeconds = resume ? Number(resume) : null;

  const [show] = await db
    .select()
    .from(shows)
    .where(
      and(
        eq(shows.slug, showSlug),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);
  if (!show) notFound();

  const showSeasons = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.showId, show.id))
    .orderBy(asc(seasons.number))
    .limit(1);

  if (showSeasons.length === 0) {
    return <ComingSoon showTitle={show.title} showSlug={show.slug} />;
  }

  const seasonIds = showSeasons.map((s) => s.id);
  const ready = await db
    .select()
    .from(episodes)
    .where(
      and(
        inArray(episodes.seasonId, seasonIds),
        eq(episodes.status, "ready"),
      ),
    )
    .orderBy(asc(episodes.number))
    .limit(1);

  if (ready.length === 0 || !ready[0].muxPlaybackId) {
    return <ComingSoon showTitle={show.title} showSlug={show.slug} />;
  }
  const episode = ready[0];

  const { userId } = await auth();
  let isSubscriber = false;
  if (userId) {
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active"),
        ),
      )
      .limit(1);
    isSubscriber = !!sub;
  }

  if (isSubscriber) {
    return (
      <WatchShell
        showTitle={show.title}
        episodeTitle={episode.title}
        showSlug={show.slug}
      >
        <Player
          episodeId={episode.id}
          playbackId={episode.muxPlaybackId!}
          title={episode.title}
          mode="subscriber"
          showSlug={show.slug}
          resumeSeconds={resumeSeconds}
        />
      </WatchShell>
    );
  }

  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) {
    redirect(`/subscribe?show=${show.slug}`);
  }

  const trial = await getOrCreateTrialSession(sessionToken, show.id);

  if (trial.converted) {
    return (
      <WatchShell
        showTitle={show.title}
        episodeTitle={episode.title}
        showSlug={show.slug}
      >
        <Player
          episodeId={episode.id}
          playbackId={episode.muxPlaybackId!}
          title={episode.title}
          mode="subscriber"
          showSlug={show.slug}
          resumeSeconds={resumeSeconds}
        />
      </WatchShell>
    );
  }

  if (!isTrialActive(trial)) {
    const params = new URLSearchParams({ show: show.slug });
    if (trial.lastPositionSeconds > 0) {
      params.set("resume", String(trial.lastPositionSeconds));
    }
    redirect(`/subscribe?${params.toString()}`);
  }

  return (
    <WatchShell
      showTitle={show.title}
      episodeTitle={episode.title}
      showSlug={show.slug}
    >
      <Player
        episodeId={episode.id}
        playbackId={episode.muxPlaybackId!}
        title={episode.title}
        mode="trial"
        showSlug={show.slug}
        resumeSeconds={resumeSeconds ?? (trial.lastPositionSeconds || null)}
      />
    </WatchShell>
  );
}

function ComingSoon({
  showTitle,
  showSlug,
}: {
  showTitle: string;
  showSlug: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black px-6">
      <Link
        href={`/shows/${showSlug}`}
        className="absolute left-6 top-5 inline-flex h-10 items-center gap-2 rounded-full bg-black/40 px-4 text-sm text-white backdrop-blur-md transition-colors hover:bg-black/70"
      >
        ← {showTitle}
      </Link>
      <div className="flex flex-1 items-center justify-center">
        <div className="space-y-2 text-center">
          <p className="font-display text-4xl italic text-white">Coming soon</p>
          <p className="text-sm text-white/60">No episodes ready yet.</p>
        </div>
      </div>
    </div>
  );
}
