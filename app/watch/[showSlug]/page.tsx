import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  subscriptions,
  watchProgress,
} from "@/db/schema";
import { Player, type PlayerEpisode } from "@/components/watch/player";
import { WatchShell } from "@/components/watch/watch-shell";
import { muxThumbnailUrl } from "@/lib/mux-token";
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
  searchParams: Promise<{ resume?: string; ep?: string }>;
}) {
  const { showSlug } = await params;
  const { resume, ep: epParam } = await searchParams;

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
    .select({ id: seasons.id, number: seasons.number, title: seasons.title })
    .from(seasons)
    .where(eq(seasons.showId, show.id))
    .orderBy(asc(seasons.number));

  if (showSeasons.length === 0) {
    return <ComingSoon showTitle={show.title} showSlug={show.slug} />;
  }

  const seasonNumberById = new Map(showSeasons.map((s) => [s.id, s.number]));
  const seasonIds = showSeasons.map((s) => s.id);

  const allReady = await db
    .select({
      id: episodes.id,
      seasonId: episodes.seasonId,
      number: episodes.number,
      title: episodes.title,
      description: episodes.description,
      durationSeconds: episodes.durationSeconds,
      muxPlaybackId: episodes.muxPlaybackId,
      muxPlaybackPolicy: episodes.muxPlaybackPolicy,
      status: episodes.status,
      introStartSeconds: episodes.introStartSeconds,
      introEndSeconds: episodes.introEndSeconds,
    })
    .from(episodes)
    .where(
      and(
        inArray(episodes.seasonId, seasonIds),
        eq(episodes.status, "ready"),
      ),
    )
    .orderBy(asc(episodes.seasonId), asc(episodes.number));

  if (allReady.length === 0) {
    return <ComingSoon showTitle={show.title} showSlug={show.slug} />;
  }

  // Order list across seasons then episode number. Build playable shape
  // up-front so the Player can switch between them without re-fetching the
  // catalog from the client.
  const ordered = [...allReady].sort((a, b) => {
    const sa = seasonNumberById.get(a.seasonId) ?? 0;
    const sb = seasonNumberById.get(b.seasonId) ?? 0;
    return sa - sb || a.number - b.number;
  });

  const playable: PlayerEpisode[] = ordered
    .filter((e) => !!e.muxPlaybackId)
    .map((e) => {
      let thumbnailUrl: string | null = null;
      try {
        thumbnailUrl = muxThumbnailUrl(e.muxPlaybackId!, e.muxPlaybackPolicy, {
          width: 320,
          height: 180,
        });
      } catch {
        // Missing signing env or other failure — fall back to tone gradient.
        thumbnailUrl = null;
      }
      return {
        id: e.id,
        number: e.number,
        seasonNumber: seasonNumberById.get(e.seasonId) ?? 0,
        title: e.title,
        description: e.description,
        durationSeconds: e.durationSeconds,
        playbackId: e.muxPlaybackId!,
        introStartSeconds: e.introStartSeconds,
        introEndSeconds: e.introEndSeconds,
        thumbnailUrl,
      };
    });

  if (playable.length === 0) {
    return <ComingSoon showTitle={show.title} showSlug={show.slug} />;
  }

  // Resolve ?ep=<id>; fall back to first playable when the query param
  // doesn't match (treat unknown ids as "start over").
  const initial = epParam
    ? (playable.find((e) => e.id === epParam) ?? playable[0])
    : playable[0];

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

  // For subscribers, look up per-episode watch progress so a refresh / new
  // tab resumes where they left off without relying on URL ?resume=.
  let resumeFromProgress: number | null = null;
  if (userId && isSubscriber) {
    const [wp] = await db
      .select({ positionSeconds: watchProgress.positionSeconds })
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.userId, userId),
          eq(watchProgress.episodeId, initial.id),
        ),
      )
      .limit(1);
    if (wp && wp.positionSeconds > 0) {
      resumeFromProgress = wp.positionSeconds;
    }
  }

  const queryResume = resume ? Number(resume) : null;

  if (isSubscriber) {
    return (
      <WatchShell>
        <Player
          mode="subscriber"
          showSlug={show.slug}
          showTitle={show.title}
          episodes={playable}
          initialEpisodeId={initial.id}
          resumeSeconds={queryResume ?? resumeFromProgress}
        />
      </WatchShell>
    );
  }

  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) {
    redirect(`/subscribe?show=${show.slug}`);
  }

  const trial = await getOrCreateTrialSession(sessionToken, show.id);

  // We intentionally don't short-circuit on trial.converted here — a former
  // subscriber (paid then canceled) with a still-set cookie would otherwise
  // get subscriber-mode access for life. Active subscribers were already
  // caught by the isSubscriber check above; everyone else falls through to
  // the trial-expiry / new-trial flow.
  if (!isTrialActive(trial)) {
    const sp = new URLSearchParams({ show: show.slug });
    // lastPositionSeconds is only meaningful for the user's first trial of
    // this show; for a converted trial it's a stale offset from before they
    // were a subscriber.
    if (!trial.converted && trial.lastPositionSeconds > 0) {
      sp.set("resume", String(trial.lastPositionSeconds));
    }
    redirect(`/subscribe?${sp.toString()}`);
  }

  return (
    <WatchShell>
      <Player
        mode="trial"
        showSlug={show.slug}
        showTitle={show.title}
        episodes={playable}
        initialEpisodeId={initial.id}
        resumeSeconds={queryResume ?? (trial.lastPositionSeconds || null)}
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
        className="absolute left-6 top-5 inline-flex h-10 items-center gap-2 rounded-full bg-black/45 px-4 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-black/70"
      >
        ← {showTitle}
      </Link>
      <div className="flex flex-1 items-center justify-center">
        <div className="space-y-2 text-center">
          <p className="text-3xl font-extrabold tracking-tight text-white">
            Coming soon
          </p>
          <p className="text-sm text-white/60">No episodes ready yet.</p>
        </div>
      </div>
    </div>
  );
}
