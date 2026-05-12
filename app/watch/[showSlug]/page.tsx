import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows, subscriptions } from "@/db/schema";
import { Player } from "@/components/watch/player";
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

  // Find the first ready episode of the first season.
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

  // Subscriber path bypasses the trial entirely.
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

  // Anonymous / non-subscriber: trial-session flow.
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) {
    // proxy.ts should have set this. Bail gracefully if not.
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

function WatchShell({
  showTitle,
  episodeTitle,
  showSlug,
  children,
}: {
  showTitle: string;
  episodeTitle: string;
  showSlug: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <Link
        href={`/shows/${showSlug}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {showTitle}
      </Link>
      <h1 className="text-xl font-semibold">{episodeTitle}</h1>
      {children}
    </div>
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
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <Link
        href={`/shows/${showSlug}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← {showTitle}
      </Link>
      <div className="flex aspect-video w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
        Coming soon — no episodes ready yet.
      </div>
    </div>
  );
}
