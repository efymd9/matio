import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
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
import { getDict } from "@/lib/i18n/server";
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

// Fork copy lives on the rows in es/en (#143); the player gets ONE string per
// field, picked here — the English one, the site's only language since #445.
// A row missing it falls back to the Spanish rather than to nothing — the
// admin form requires both for a real fork, so this only ever covers a
// half-typed silent transition.
function englishFirst(en: string | null, es: string | null): string | null {
  return en || es;
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
  // grouped by parent. Labels and the prompt are picked here (englishFirst)
  // — the player never reads a language for row copy (its dictionary covers
  // only the prompt's own chrome). Targets are resolved against the
  // playable array client-side (resolveCandidates drops a missing one).
  // The query runs only for a show that HAS a branch — this page is
  // force-dynamic, so a linear show would otherwise pay it on every render
  // (a choice between two listed episodes with no branch anywhere in the
  // show is not a case the admin form produces on purpose, and is not
  // honoured).
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
      label: englishFirst(edge.labelEn, edge.labelEs) ?? "",
      isDefault: edge.isDefault,
    });
    choicesByParent.set(edge.fromEpisodeId, list);
  }

  // Every show is walled per episode: the player locks episodes CLIENT-SIDE
  // from the tier prop via isEpisodeLocked, so the tier each episode
  // presents to THIS viewer comes from the one rule (resolveEffectiveTier,
  // lib/episode-access.ts) the token route also mints from — neutralizing
  // only the token route is the free-pivot bug.
  //
  // Paid mode (#462): registration first, then the paywall. For an anonymous
  // viewer a subscriber episode presents as `member`, so mode="free" renders
  // the SignupWall full-surface with zero token fetches; signed in, it
  // presents as `subscriber` and mode="member" renders the Paywall. The
  // legacy 60s preview (all-subscriber shows, mode="trial") and its
  // expired-trial redirect to /subscribe are gone.
  //
  // Free pivot: with payments off every episode presents as the free tier.
  // Signup gate (REQUIRE_SIGNUP=1, free mode only): a free episode plays for
  // anyone, anything above it reads `member` — locked in mode="free" (the
  // SignupWall), unlocked in mode="member", so signed-in viewers play
  // everything unchanged.
  const paymentsOn = paymentsEnabled();
  const signupGate = signupRequired();
  const { userId } = await auth();
  const signedIn = Boolean(userId);

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
        tier: resolveEffectiveTier(e.access, {
          paymentsOn,
          signupGate,
          signedIn,
        }),
        branchOfEpisodeId: e.branchOfEpisodeId,
        forkPrompt: englishFirst(e.forkPromptEn, e.forkPromptEs),
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
  // form. Cheap single-row lookup; only fires for signed-in viewers.
  let userEmail: string | null = null;
  if (userId) {
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    userEmail = u?.email ?? null;
  }

  // For signed-in viewers, look up per-episode watch progress so a refresh /
  // new tab resumes where they left off without relying on URL ?resume=.
  let resumeFromProgress: number | null = null;
  if (userId) {
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

  if (userId) {
    // Members (signed-in non-subscribers), on every show — all-subscriber
    // ones included since #462: a subscriber episode reads `subscriber` and
    // the player answers it with the Paywall. Freshly signed-up users land
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
    // Same runtime read as the other branches (see the note there). THIS is
    // the branch the wallet button exists for: a signed-in non-subscriber
    // whose member tier ran out is looking at the subscription paywall.
    const walletKey = walletCheckoutEnabled() ? getPublishableKey() : null;

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
          walletPublishableKey={walletKey}
          freeMode={!paymentsOn}
        />
      </WatchShell>
    );
  }

  // Anonymous viewer: free tier. Resume from the session row — last episode
  // watched (when no explicit ?ep= deep link) at its last position. Every
  // episode above the free tier reads `member` here (resolveEffectiveTier),
  // so the player answers it with the SignupWall, never the Paywall: in paid
  // mode the paywall comes after the account (#462). payFirst therefore no
  // longer reaches the player's paywall; it is still threaded through
  // untouched (the guest-checkout code and /welcome stay as they are).
  const payFirst = process.env.PAY_FIRST_CHECKOUT === "1";
  // Runtime read (getPublishableKey), never an inlined `process.env
  // .NEXT_PUBLIC_…`: the key can be added to an already-built deployment and
  // Vercel reuses Next's inlined client chunks across an env-only change.
  // Null unless the wallet flag is on too, so the paywall mounts nothing —
  // and pulls no Stripe.js — while the vertical is dark. (#210)
  const walletKey = walletCheckoutEnabled() ? getPublishableKey() : null;
  const freeSessionToken = (await cookies()).get(TRIAL_COOKIE)?.value ?? null;
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

  // What the SignupWall may promise: the listed episodes an account really
  // opens — the ones a SIGNED-IN viewer gets as `member` under the same rule.
  // Counted from this viewer's presentation instead, it would count every
  // subscriber episode too in paid mode ("unlock 6 more episodes" — and then
  // a paywall); in free mode both counts are the same number.
  const accountUnlocks = ordered.filter(
    (e) =>
      !!e.muxPlaybackId &&
      e.branchOfEpisodeId === null &&
      resolveEffectiveTier(e.access, {
        paymentsOn,
        signupGate,
        signedIn: true,
      }) === "member",
  ).length;

  return (
    <WatchShell>
      <PurchaseBeacon result={checkoutReturn} />
      <Player
        mode="free"
        orientation={show.orientation}
        // A walled start renders the SignupWall before any playback — skip
        // the muted-autoplay capability probe it could never use. A free
        // first episode autoplays like any other.
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
        accountUnlocks={accountUnlocks}
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
