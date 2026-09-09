import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { userAgent } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  episodeChoices,
  episodes,
  seasons,
  shows,
  users,
  watchProgress,
} from "@/db/schema";
import { Player, type PlayerEpisode } from "@/components/watch/player";
import type { PlayerChoice } from "@/lib/branching";
import { WatchShell } from "@/components/watch/watch-shell";
import { CompleteRegistrationPixel } from "@/components/site/complete-registration-pixel";
import { PurchaseBeacon } from "@/components/site/purchase-beacon";
import { verifyCheckoutReturn } from "@/lib/checkout-return-verify";
import { Icon } from "@/components/site/icon";
import { muxThumbnailUrl } from "@/lib/mux-token";
import { getDict, getLocale } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/dictionaries";
import { getOrSyncCurrentUser } from "@/lib/admin";
import {
  applyUserAttribution,
  readAttributionCookies,
} from "@/lib/attribution";
import { resolveEffectiveTier } from "@/lib/episode-access";
import { getPublishableKey } from "@/lib/checkout-session";
import { walletCheckoutEnabled } from "@/lib/wallet-checkout";
import { paymentsEnabled, signupRequired } from "@/lib/free-mode";
import { hasActiveSubscription } from "@/lib/subscription-access";
import {
  TRIAL_COOKIE,
  findTrialSession,
  isTrialActive,
  linkTrialSessionsToCurrentUser,
} from "@/lib/trial";
import { linkVisitorToUser } from "@/lib/visitor";

// Belt-and-braces noindex. /watch is Disallowed in robots.txt (crawling it
// costs trial-session machinery), but a disallow alone still allows URL-only
// indexing from external links — and it stops crawlers from ever reading the
// inherited index:true meta, leaving the two signals contradicting each
// other. Declare the real intent here so they agree if the disallow is ever
// lifted. The canonical crawl surface for a show is /shows/[slug].
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

// Fork copy lives on the rows in both site locales (#143); the player gets
// ONE string per field, picked here. A row missing one locale falls back to
// the other rather than to nothing — the admin form requires both for a
// real fork, so this only ever covers a half-typed silent transition.
function inLocale(
  locale: Locale,
  es: string | null,
  en: string | null,
): string | null {
  return locale === "es" ? (es || en) : (en || es);
}

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ showSlug: string }>;
  searchParams: Promise<{ resume?: string; ep?: string; cs?: string }>;
}) {
  const { showSlug } = await params;
  // `cs` = the Checkout Session id Stripe appends to the signed-in return_url
  // (app/subscribe/actions.ts) — consumed by <CheckoutReturnBeacon/> below.
  const { resume, ep: epParam, cs } = await searchParams;

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
      branchOfEpisodeId: episodes.branchOfEpisodeId,
      forkPromptEn: episodes.forkPromptEn,
      forkPromptEs: episodes.forkPromptEs,
      forkWindowSeconds: episodes.forkWindowSeconds,
    })
    .from(episodes)
    .where(
      and(
        inArray(episodes.seasonId, seasonIds),
        eq(episodes.status, "ready"),
        // Branching video (#144): branches are INCLUDED — playable but
        // unlisted. The Player keeps them in its `episodes` array (a
        // choice or a ?ep= deep link lands on one) and filters every list
        // it renders through listedEpisodes(); its transition reads the
        // choice graph (resolveCandidates), never `episodes[idx + 1]`.
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

  // Branching (#144): the edges of every ready episode in one query,
  // grouped by parent. Labels and the prompt are picked in the SITE locale
  // here — the player never reads the locale for row copy (its dictionary
  // covers only the prompt's own chrome). Targets are resolved against the
  // playable array client-side (resolveCandidates drops a missing one).
  // The query runs only for a show that HAS a branch — this page is
  // force-dynamic, so a linear show would otherwise pay it on every render
  // (a choice between two listed episodes with no branch anywhere in the
  // show is not a case the admin form produces on purpose, and is not
  // honoured).
  const locale = await getLocale();
  const hasBranches = ordered.some((e) => e.branchOfEpisodeId !== null);
  const edges = hasBranches
    ? await db
        .select({
          fromEpisodeId: episodeChoices.fromEpisodeId,
          toEpisodeId: episodeChoices.toEpisodeId,
          position: episodeChoices.position,
          labelEn: episodeChoices.labelEn,
          labelEs: episodeChoices.labelEs,
          isDefault: episodeChoices.isDefault,
        })
        .from(episodeChoices)
        .where(
          inArray(
            episodeChoices.fromEpisodeId,
            ordered.map((e) => e.id),
          ),
        )
        .orderBy(asc(episodeChoices.position))
    : [];
  const choicesByParent = new Map<string, PlayerChoice[]>();
  for (const edge of edges) {
    const list = choicesByParent.get(edge.fromEpisodeId) ?? [];
    list.push({
      toEpisodeId: edge.toEpisodeId,
      position: edge.position,
      label: inLocale(locale, edge.labelEs, edge.labelEn) ?? "",
      isDefault: edge.isDefault,
    });
    choicesByParent.set(edge.fromEpisodeId, list);
  }

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
  //
  // Signup gate (REQUIRE_SIGNUP=1, free mode only): the admin's per-episode
  // tier decides (resolveEffectiveTier) — a free episode plays for anyone,
  // anything above it reads locked in mode="free" and the player renders the
  // SignupWall full-surface with zero token fetches (the same prop-driven
  // path a member-tier deep link takes in paid mode). Signed-in viewers are
  // in mode="member" where the member tier is unlocked, so they play
  // everything unchanged.
  const paymentsOn = paymentsEnabled();
  const signupGate = signupRequired();
  // Listed episodes only — the twin of showHasTierGating's
  // `isNull(branchOfEpisodeId)` (lib/episode-access.ts): since #144 `ordered`
  // carries the branches too, and a hidden free/member branch must not flip
  // an all-subscriber show to per-episode walls in paid mode. Keep the two
  // predicates identical.
  const gated =
    !paymentsOn ||
    ordered.some(
      (e) => e.branchOfEpisodeId === null && e.access !== "subscriber",
    );

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
        tier: resolveEffectiveTier(e.access, { paymentsOn, signupGate }),
        branchOfEpisodeId: e.branchOfEpisodeId,
        forkPrompt: inLocale(locale, e.forkPromptEs, e.forkPromptEn),
        forkWindowSeconds: e.forkWindowSeconds,
        choices: choicesByParent.get(e.id) ?? null,
      };
    });

  if (playable.length === 0) {
    return <ComingSoon showTitle={show.title} showSlug={show.slug} />;
  }

  // Resolve ?ep=<id>; fall back to first playable when the query param
  // doesn't match (treat unknown ids as "start over"). A branch id resolves
  // too (#144) — the continue-watching tile and the post-signup redirect
  // land on the branch itself, and the player prints its parent's number.
  const initial = epParam
    ? (playable.find((e) => e.id === epParam) ?? playable[0])
    : playable[0];

  const { userId } = await auth();
  // Signed-in checkout return (`?cs=`): verify the session at Stripe as paid
  // and OURS, mirror the subscription inline (so the paint below already
  // shows the subscriber state — the guest flow does the same on /welcome),
  // and key the purchase beacon with the subscription id.
  const checkoutReturn = await verifyCheckoutReturn(cs, userId);
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
    // Subscribers exist in the users mirror by definition (the subscription
    // row references it), so the visitor merge is safe here without the
    // getOrSyncCurrentUser the member branch needs. Without this call a
    // subscriber's browser never links its visit history and their
    // users.country never stamps — the geo panels read them as unknown.
    await linkVisitorToUser(userId!);
    return (
      <WatchShell>
        <PurchaseBeacon result={checkoutReturn} />
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
      // Merge the first-party anonymous visit history into the account
      // ("склейка") + stamp users.country. First link wins; never throws.
      // This surface is where fresh signups land from the wall redirect,
      // so the visitor funnel's "registered" stage depends on it.
      await linkVisitorToUser(userId);
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
          <PurchaseBeacon result={checkoutReturn} />
          <CompleteRegistrationPixel userId={userId} utm={signupUtm} paymentsEnabled={paymentsOn} />
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
    // Runtime read (getPublishableKey), never an inlined `process.env
    // .NEXT_PUBLIC_…`: the key can be added to an already-built deployment and
    // Vercel reuses Next's inlined client chunks across an env-only change.
    // Null unless the wallet flag is on too, so the paywall mounts nothing —
    // and pulls no Stripe.js — while the vertical is dark. (#210)
    const walletKey = walletCheckoutEnabled() ? getPublishableKey() : null;
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
        <PurchaseBeacon result={checkoutReturn} />
        <Player
          mode="free"
          orientation={show.orientation}
          // A gated start renders the SignupWall before any playback — skip
          // the muted-autoplay capability probe it could never use. A free
          // first episode under the same gate autoplays like any other.
          autoplay={freeInitial.tier === "free" ? autoplay : false}
          showId={show.id}
          showSlug={show.slug}
          showTitle={show.title}
          episodes={playable}
          initialEpisodeId={freeInitial.id}
          resumeSeconds={queryResume ?? freeResume}
          userEmail={userEmail}
          payFirst={payFirst}
          walletPublishableKey={walletKey}
          freeMode={!paymentsOn}
          signupGate={signupGate}
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
  // See the note on the tier-gated branch: runtime read, gated on the flag.
  const walletKey = walletCheckoutEnabled() ? getPublishableKey() : null;
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
      <PurchaseBeacon result={checkoutReturn} />
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
        walletPublishableKey={walletKey}
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
        className="bg-gold-cta absolute left-6 top-[max(env(safe-area-inset-top),1.25rem)] inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-extrabold text-gold-deep shadow-cta transition-transform hover:scale-[1.02] active:scale-[0.98]"
      >
        <Icon name="back" size={16} />
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
