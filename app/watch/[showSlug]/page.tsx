import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { userAgent } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  users,
  watchProgress,
} from "@/db/schema";
import { Player, type PlayerEpisode } from "@/components/watch/player";
import { WatchShell } from "@/components/watch/watch-shell";
import { CompleteRegistrationPixel } from "@/components/site/complete-registration-pixel";
import { Icon } from "@/components/site/icon";
import { muxThumbnailUrl } from "@/lib/mux-token";
import { getDict } from "@/lib/i18n/server";
import { getOrSyncCurrentUser } from "@/lib/admin";
import {
  applyUserAttribution,
  readAttributionCookies,
} from "@/lib/attribution";
import { paymentsEnabled } from "@/lib/free-mode";
import { hasActiveSubscription } from "@/lib/subscription-access";
import {
  TRIAL_COOKIE,
  findTrialSession,
  isTrialActive,
  linkTrialSessionsToCurrentUser,
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
      access: episodes.access,
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

  // Tier-gated iff any ready episode is open below the subscriber tier
  // (mirrors showHasTierGating in lib/episode-access.ts). All-subscriber
  // shows keep the legacy 60s-trial flow below.
  //
  // Free pivot: with payments off every show takes the gated path (member
  // mode signed-in, free mode anonymous) and every episode presents as the
  // free tier — the player locks episodes CLIENT-SIDE from the tier prop
  // via isEpisodeLocked, so neutralizing the tiers here (not just the token
  // route) is load-bearing. The legacy 60s-trial branch and the
  // expired-trial redirect below become unreachable.
  const paymentsOn = paymentsEnabled();
  const gated = !paymentsOn || ordered.some((e) => e.access !== "subscriber");

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
        tier: paymentsOn ? e.access : ("free" as const),
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
  // hasActiveSubscription bundles the status-set and current_period_end
  // checks in one place; see lib/subscription-access.ts for why past_due
  // grants access and why the period-end timestamp is also enforced.
  const isSubscriber = userId ? await hasActiveSubscription(userId) : false;

  // Crawlers keep the poster play-gate: autoplay-on-land makes the player
  // fetch a token on mount, which (for anonymous modes) mints a
  // trial_sessions row — JS-rendering bots would pollute the funnel and
  // burn the per-(IP, show) rate-limit buckets. Next's isBot list only
  // covers declared crawlers, so it's supplemented with the common
  // JS-rendering auditors/monitors that slip through (fail-open by design
  // — an unflagged bot just mints one row).
  const reqHeaders = await headers();
  const uaString = reqHeaders.get("user-agent") ?? "";
  const autoplay =
    !userAgent({ headers: reqHeaders }).isBot &&
    !/headless|lighthouse|pagespeed|gtmetrix|ptst|pingdom|uptime|statuscake|checkly|synthetics|crawl|spider|scrape/i.test(
      uaString,
    );

  // Look up the user's email to pre-fill the SeriesEndOverlay reminder
  // form. Cheap single-row lookup; only fires for signed-in viewers
  // (anonymous trial users never reach the series-end overlay anyway).
  let userEmail: string | null = null;
  if (userId) {
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    userEmail = u?.email ?? null;
  }

  // For subscribers, look up per-episode watch progress so a refresh / new
  // tab resumes where they left off without relying on URL ?resume=.
  let resumeFromProgress: number | null = null;
  if (userId && (isSubscriber || gated)) {
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
          orientation={show.orientation}
          autoplay={autoplay}
          showId={show.id}
          showSlug={show.slug}
          showTitle={show.title}
          episodes={playable}
          initialEpisodeId={initial.id}
          resumeSeconds={queryResume ?? resumeFromProgress}
          userEmail={userEmail}
        />
      </WatchShell>
    );
  }

  // Episode-gated show: positional tiers instead of the 60s clock. No
  // expired-trial redirect here — gated sessions never expire; the walls
  // are positional and rendered by the player.
  if (gated) {
    if (userId) {
      // Members (signed-in non-subscribers). Freshly signed-up users land
      // here straight from the wall's redirect, so do what /subscribe does:
      // sync the Clerk mirror first (the user.created webhook may lag),
      // then link their anonymous session rows — funnel stage 4 depends on
      // this link existing.
      await getOrSyncCurrentUser();
      await linkTrialSessionsToCurrentUser();
      // Free mode only: /subscribe — the historical applyUserAttribution
      // call site — redirects home while payments are off, so without this
      // no account would ever get first/last-touch stamped and every signup
      // would read "(direct)" in the per-campaign tables. The watch page is
      // where signed-in users actually land from tracked links. Paid mode
      // keeps the /subscribe-only stamping unchanged (free-pivot rule: the
      // flag branches at surfaces, and this surface IS the free funnel).
      if (!paymentsOn) {
        await applyUserAttribution(userId);
      }

      // Signup-completion events (Meta Lead/CompleteRegistration + PostHog
      // signup_completed) historically fired on /subscribe; this flow
      // returns users here instead. Same deduped component + same
      // localStorage flag → no double-fires for users who saw /subscribe.
      const { first: firstTouch } = await readAttributionCookies();
      const signupUtm: Record<string, string> = {};
      if (firstTouch.source) signupUtm.utm_source = firstTouch.source;
      if (firstTouch.medium) signupUtm.utm_medium = firstTouch.medium;
      if (firstTouch.campaign) signupUtm.utm_campaign = firstTouch.campaign;

      return (
        <WatchShell>
          <CompleteRegistrationPixel userId={userId} utm={signupUtm} />
          <Player
            mode="member"
            orientation={show.orientation}
            autoplay={autoplay}
            showId={show.id}
            showSlug={show.slug}
            showTitle={show.title}
            episodes={playable}
            initialEpisodeId={initial.id}
            resumeSeconds={queryResume ?? resumeFromProgress}
            userEmail={userEmail}
            freeMode={!paymentsOn}
          />
        </WatchShell>
      );
    }

    // Anonymous viewer: free tier. Resume from the session row — last
    // episode watched (when no explicit ?ep= deep link) at its last
    // position. payFirst routes the wall's signed-out CTA straight to
    // guest Stripe Checkout (PAY_FIRST_CHECKOUT flag).
    const payFirst = process.env.PAY_FIRST_CHECKOUT === "1";
    const freeSessionToken =
      (await cookies()).get(TRIAL_COOKIE)?.value ?? null;
    const freeSession = freeSessionToken
      ? await findTrialSession(freeSessionToken, show.id)
      : null;

    let freeInitial = initial;
    if (!epParam && freeSession?.lastEpisodeId) {
      const last = playable.find((e) => e.id === freeSession.lastEpisodeId);
      if (last) freeInitial = last;
    }
    const freeResume =
      freeSession &&
      freeSession.lastEpisodeId === freeInitial.id &&
      freeSession.lastPositionSeconds > 0
        ? freeSession.lastPositionSeconds
        : null;

    return (
      <WatchShell>
        <Player
          mode="free"
          orientation={show.orientation}
          autoplay={autoplay}
          showId={show.id}
          showSlug={show.slug}
          showTitle={show.title}
          episodes={playable}
          initialEpisodeId={freeInitial.id}
          resumeSeconds={queryResume ?? freeResume}
          userEmail={userEmail}
          payFirst={payFirst}
          freeMode={!paymentsOn}
        />
      </WatchShell>
    );
  }

  // Trial branch. The trial row is created lazily inside
  // /api/playback-token when the player actually requests a token — for
  // human visitors the player autoplays on land, so the 60-second clock
  // starts with the first render's token fetch; bots keep the poster
  // play-gate and never mint. Either way we never record a row for an
  // unpublished show. Here we only *read* the row to decide whether to
  // render the player or bounce an expired-trial user straight to
  // /subscribe.
  //
  // We intentionally don't short-circuit on trial.converted — a former
  // subscriber (paid then canceled) with a still-set cookie would otherwise
  // get subscriber-mode access for life. Active subscribers were already
  // caught by the isSubscriber check above.
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value ?? null;
  const trial = sessionToken
    ? await findTrialSession(sessionToken, show.id)
    : null;

  // Pay-first: a returning expired-trial visitor stays on the watch page —
  // the player's first token fetch 403s and renders the paywall, whose
  // signed-out CTA goes straight to guest Checkout. The legacy redirect to
  // /subscribe would bounce an anonymous visitor off Clerk sign-up instead,
  // re-erecting exactly the wall the flag removes.
  const payFirst = process.env.PAY_FIRST_CHECKOUT === "1";
  if (trial && !isTrialActive(trial) && !payFirst) {
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
        orientation={show.orientation}
        autoplay={autoplay}
        showId={show.id}
        showSlug={show.slug}
        showTitle={show.title}
        episodes={playable}
        initialEpisodeId={initial.id}
        resumeSeconds={queryResume ?? (trial?.lastPositionSeconds || null)}
        userEmail={userEmail}
        payFirst={payFirst}
      />
    </WatchShell>
  );
}

async function ComingSoon({
  showTitle,
  showSlug,
}: {
  showTitle: string;
  showSlug: string;
}) {
  const { t } = await getDict();
  return (
    <div className="glow-floor fixed inset-0 z-50 flex flex-col bg-espresso px-6">
      <Link
        href={`/shows/${showSlug}`}
        className="bg-gold-cta absolute left-6 top-[max(env(safe-area-inset-top),1.25rem)] inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <Icon name="back" size={16} color="#241205" />
        {showTitle}
      </Link>
      <div className="flex flex-1 items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="font-display text-4xl uppercase tracking-[0.02em] text-cream sm:text-5xl">
            {t.watch.comingSoonTitle}
          </p>
          <p className="text-sm text-cream/60">{t.watch.noEpisodesReady}</p>
        </div>
      </div>
    </div>
  );
}
