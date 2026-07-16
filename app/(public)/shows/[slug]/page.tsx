import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { actors, episodes, seasons, showActors } from "@/db/schema";
import { paymentsEnabled, signupRequired } from "@/lib/free-mode";
import { muxThumbnailUrl } from "@/lib/mux-token";
import { getDict } from "@/lib/i18n/server";
import type { Dict } from "@/lib/i18n/dictionaries";
import { getShowBySlug } from "@/lib/show-query";
import { SITE_URL, canonicalUrl, metaDescription } from "@/lib/seo";
import {
  breadcrumbJsonLd,
  jsonLdScript,
  tvSeriesJsonLd,
} from "@/lib/structured-data";
import { ViewContentPixel } from "@/components/site/view-content-pixel";
import { ActorChip } from "@/components/site/actor-chip";
import { Icon } from "@/components/site/icon";
import { MetaDot } from "@/components/site/meta-dot";
import { ShareButton } from "@/components/site/share-button";
import { TONE_GRADIENT, toneFor } from "@/lib/design";
import { cn } from "@/lib/utils";

// Per-show metadata: makes Slack / Twitter / iMessage unfurls show the
// actual show title and (where set) its hero artwork instead of the
// generic site default. Hero image takes precedence over poster — it's
// 16:9 which matches the OG card aspect; poster is a fallback.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const show = await getShowBySlug(slug);
  const { t } = await getDict();
  if (!show) return { title: t.showDetail.notFound };
  const url = canonicalUrl(`/shows/${slug}`);
  // Null-description shows otherwise ship with NO meta description; synthesize
  // a unique, genre-varied line (anti-thin-content) instead of a constant.
  // metaDescription() collapses the DB synopsis's raw \r\n breaks and
  // truncates to snippet length — the JSON-LD keeps the full text.
  const description = metaDescription(
    show.description ??
      (paymentsEnabled()
        ? t.showDetail.synopsisFallback(show.title, show.genre)
        : t.showDetail.synopsisFallbackFree(show.title, show.genre)),
  );
  return {
    title: t.showDetail.watchOnlineTitle(show.title),
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "video.tv_show",
      url,
      title: show.title,
      description,
      // og:image / twitter:image come from the per-show opengraph-image.tsx
      // (branded 1200×630 card). Don't also set images here — both would
      // double-emit conflicting og:image tags.
    },
    twitter: {
      card: "summary_large_image",
      title: show.title,
      description,
    },
  };
}

type EpisodeRowData = {
  id: string;
  seasonId: string;
  number: number;
  title: string;
  description: string | null;
  durationSeconds: number | null;
  muxPlaybackId: string | null;
  muxPlaybackPolicy: string | null;
  status: "processing" | "ready" | "errored";
  access: "free" | "member" | "subscriber";
  thumbnailUrl: string | null;
};

export default async function ShowDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { t } = await getDict();

  const show = await getShowBySlug(slug);
  if (!show) notFound();

  const showSeasons = await db
    .select()
    .from(seasons)
    .where(eq(seasons.showId, show.id))
    .orderBy(asc(seasons.number));

  // Virtual-actor cast, in the admin-set display order; (position, name)
  // keeps legacy position ties stable — same rule the admin panel uses.
  const cast = await db
    .select({
      slug: actors.slug,
      name: actors.name,
      tagline: actors.tagline,
      bio: actors.bio,
      avatarImageUrl: actors.avatarImageUrl,
      characterName: showActors.characterName,
    })
    .from(showActors)
    .innerJoin(actors, eq(showActors.actorId, actors.id))
    .where(eq(showActors.showId, show.id))
    .orderBy(asc(showActors.position), asc(actors.name));

  const seasonIds = showSeasons.map((s) => s.id);
  const rawEpisodes =
    seasonIds.length === 0
      ? []
      : await db
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
          })
          .from(episodes)
          .where(inArray(episodes.seasonId, seasonIds))
          .orderBy(asc(episodes.number));

  const allEpisodes: EpisodeRowData[] = rawEpisodes.map((e) => {
    let thumbnailUrl: string | null = null;
    if (e.muxPlaybackId && e.status === "ready") {
      try {
        thumbnailUrl = muxThumbnailUrl(e.muxPlaybackId, e.muxPlaybackPolicy, {
          width: 320,
          height: 180,
        });
      } catch {
        thumbnailUrl = null;
      }
    }
    return { ...e, thumbnailUrl };
  });

  const episodesBySeason = new Map<string, EpisodeRowData[]>();
  for (const e of allEpisodes) {
    const list = episodesBySeason.get(e.seasonId) ?? [];
    list.push(e);
    episodesBySeason.set(e.seasonId, list);
  }

  const totalEpisodes = allEpisodes.filter((e) => e.status === "ready").length;
  const backdrop = show.heroImageUrl ?? show.posterImageUrl;
  const tone = toneFor(show.slug);

  // Structured data. BreadcrumbList (Home → show) is a live rich result;
  // TVSeries/TVSeason/TVEpisode feed entity understanding and tie the show to
  // the Matio Organization. Subscription gating is declared honestly via
  // isAccessibleForFree on the CreativeWork entities — no VideoObject (Google
  // requires that on a page where the user can watch, and the player lives on
  // the robots-disallowed /watch). Only ready episodes are advertised.
  // "Honestly" includes the payments kill-switch: with payments off every
  // episode actually plays free, so the declaration must say so. The signup
  // gate flips it back to false — Google's paywalled-content guidance
  // treats registration walls like paywalls, and claiming "free" for
  // account-gated video reads as cloaking.
  const paymentsOn = paymentsEnabled();
  const signupGate = signupRequired();
  const readyEpisodes = allEpisodes.filter((e) => e.status === "ready");
  const seriesJsonLd = tvSeriesJsonLd({
    slug: show.slug,
    title: show.title,
    description: show.description,
    images: [show.heroImageUrl, show.posterImageUrl].filter(
      (u): u is string => !!u,
    ),
    genre: show.genre,
    numberOfSeasons: showSeasons.length,
    numberOfEpisodes: readyEpisodes.length,
    isAccessibleForFree:
      readyEpisodes.length > 0 &&
      (paymentsOn
        ? readyEpisodes.every((e) => e.access === "free")
        : !signupGate),
    actors: cast.map((m) => ({
      name: m.name,
      url: canonicalUrl(`/actors/${m.slug}`),
    })),
    seasons: showSeasons.map((s) => ({
      number: s.number,
      name: s.title,
      episodes: (episodesBySeason.get(s.id) ?? [])
        .filter((e) => e.status === "ready")
        .map((e) => ({
          number: e.number,
          name: e.title,
          description: e.description,
          durationSeconds: e.durationSeconds,
          isAccessibleForFree: paymentsOn
            ? e.access === "free"
            : !signupGate,
        })),
    })),
  });
  const breadcrumbLd = breadcrumbJsonLd([
    { name: t.showDetail.breadcrumbHome, url: SITE_URL },
    { name: show.title, url: canonicalUrl(`/shows/${show.slug}`) },
  ]);

  return (
    <main className="bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(seriesJsonLd) }}
      />
      {/* Meta Pixel ViewContent — renders nothing; fires once the consent-
          gated pixel has loaded. */}
      <ViewContentPixel
        slug={show.slug}
        title={show.title}
        genre={show.genre[0] ?? null}
      />

      {/* Hero */}
      <section className="relative isolate h-[520px] w-full overflow-hidden tablet:h-[560px] xl:h-[620px]">
        {backdrop ? (
          <Image
            src={backdrop}
            alt=""
            aria-hidden
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ backgroundImage: TONE_GRADIENT[tone] }}
          />
        )}
        <div
          aria-hidden
          className="duotone-strong pointer-events-none absolute inset-0"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(to top, #0f0a07 4%, rgba(15,10,7,0.4) 45%, transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="glow-floor pointer-events-none absolute inset-0 xl:hidden"
        />

        {/* Top corners — back (left) + share (right), safe-area aware.
            On tablet+ the persistent site header is visible, so the row
            drops below it instead of colliding with the logo / nav. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 pl-[max(env(safe-area-inset-left),1.25rem)] pr-[max(env(safe-area-inset-right),1.25rem)] pt-[max(env(safe-area-inset-top),1rem)] tablet:pt-20">
          <Link
            href="/"
            aria-label={t.showDetail.breadcrumbHome}
            className="pointer-events-auto inline-flex h-[38px] w-[38px] items-center justify-center rounded-full border border-rust/60 bg-burgundy/45 text-cream backdrop-blur-xl transition-transform active:scale-[0.92]"
          >
            <Icon name="back" size={18} />
          </Link>
          <ShareButton title={show.title} className="pointer-events-auto" />
        </div>

        {/* Content — bottom-aligned within the hero. */}
        <div className="relative z-10 flex h-full flex-col justify-end px-6 pb-6 tablet:px-10 tablet:pb-8 xl:px-14">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
            <span className="self-start rounded-full bg-burgundy px-3.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-cream">
              {t.hero.matioOriginal}
            </span>
            <h1 className="font-display text-[42px] uppercase leading-[1.0] tracking-[0.01em] text-cream tablet:text-[56px] xl:text-[68px]">
              {show.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2.5 text-xs font-semibold text-cream/75">
              <span>{new Date(show.createdAt).getFullYear()}</span>
              {show.genre[0] && (
                <>
                  <MetaDot />
                  <span className="capitalize">{show.genre[0]}</span>
                </>
              )}
              {totalEpisodes > 0 && (
                <>
                  <MetaDot />
                  {/* Design shows an abbreviated "6 ep" here; the dict's
                      episodeCount() spells out "N episodes" — using it
                      as-is per spec rather than hardcoding new copy. */}
                  <span>{t.showDetail.episodeCount(totalEpisodes)}</span>
                </>
              )}
              <MetaDot />
              <span>{t.showDetail.ageRating}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Play CTA + synopsis */}
      {(totalEpisodes > 0 || show.description) && (
        <section className="px-6 pt-1 pb-8 tablet:px-10 xl:px-14">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            {totalEpisodes > 0 && (
              <Link
                href={`/watch/${show.slug}`}
                className="inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-gold-cta text-[15px] font-extrabold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-transform active:scale-[0.98] tablet:w-auto tablet:min-w-[220px] tablet:self-start"
              >
                <Icon name="play" size={17} color="#241205" />
                {t.showDetail.play}
              </Link>
            )}
            {show.description && (
              <p className="max-w-3xl text-sm leading-[1.6] text-cream/72">
                {show.description}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Virtual actors */}
      {cast.length > 0 && (
        <section className="px-6 pb-10 tablet:px-10 xl:px-14">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-0.5 w-3.5 shrink-0 rounded-[1px] bg-rust xl:w-[18px]"
              />
              <h2 className="font-display text-base uppercase tracking-[0.12em] text-gold xl:text-xl">
                {t.showDetail.castTitle}
              </h2>
            </div>
            <ul className="flex flex-wrap gap-x-4 gap-y-6 tablet:gap-x-6">
              {cast.map((m) => (
                <li key={m.slug}>
                  <ActorChip
                    href={`/actors/${m.slug}`}
                    name={m.name}
                    characterLabel={
                      m.characterName
                        ? t.showDetail.castAs(m.characterName)
                        : null
                    }
                    tagline={m.tagline}
                    bio={m.bio}
                    avatarUrl={m.avatarImageUrl}
                    viewProfileLabel={t.showDetail.castViewProfile}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Episodes */}
      <section className="px-6 pb-16 tablet:px-10 tablet:pb-20 xl:px-14">
        <div className="mx-auto max-w-5xl">
          {showSeasons.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-bold text-cream/50">
                {t.showDetail.noEpisodesYetHeader}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-0.5 w-3.5 shrink-0 rounded-[1px] bg-rust xl:w-[18px]"
                />
                <h2 className="font-display text-base uppercase tracking-[0.12em] text-gold xl:text-xl">
                  {t.showDetail.tabEpisodes}
                </h2>
                {showSeasons.length === 1 && (
                  <span className="ml-auto text-[11px] font-semibold text-cream/45">
                    {t.showDetail.season(showSeasons[0].number)}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-8">
                {showSeasons.map((season) => {
                  const eps = episodesBySeason.get(season.id) ?? [];
                  return (
                    <div key={season.id} className="flex flex-col gap-3">
                      {showSeasons.length > 1 && (
                        <div className="flex items-baseline gap-2">
                          <span className="text-[11px] font-semibold text-cream/45">
                            {t.showDetail.season(season.number)}
                          </span>
                          {season.title && (
                            <span className="text-[11px] text-cream/35">
                              {season.title}
                            </span>
                          )}
                        </div>
                      )}
                      {eps.length === 0 ? (
                        <p className="text-sm text-cream/55">
                          {t.showDetail.noEpisodesYetLine}
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-3">
                          {eps.map((ep) => (
                            <EpisodeRow
                              key={ep.id}
                              ep={ep}
                              showSlug={show.slug}
                              tone={tone}
                              t={t}
                            />
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function EpisodeRow({
  ep,
  showSlug,
  tone,
  t,
}: {
  ep: EpisodeRowData;
  showSlug: string;
  tone: ReturnType<typeof toneFor>;
  t: Dict;
}) {
  const playable = !!ep.muxPlaybackId && ep.status === "ready";
  const minutes = ep.durationSeconds
    ? Math.floor(ep.durationSeconds / 60)
    : null;

  // Deep-link the specific episode. Without ?ep= every row landed on the
  // watch page's default start (last-watched or episode 1) — the row's
  // episode was never passed. Locked episodes still link: the player
  // renders the matching wall (sign-up / subscribe) for them, which is
  // the designed conversion path.
  return (
    <li>
      <Link
        href={playable ? `/watch/${showSlug}?ep=${ep.id}` : "#"}
        aria-disabled={!playable}
        tabIndex={playable ? 0 : -1}
        className={cn(
          "flex items-center gap-3.5 rounded-2xl border border-rust/30 bg-espresso-2 p-2.5 transition-transform",
          playable
            ? "hover:brightness-105 active:scale-[0.99]"
            : "cursor-default opacity-70",
        )}
      >
        {/* Thumbnail — real signed Mux still if the asset is ready,
            tone-gradient placeholder otherwise. */}
        <div
          className="relative aspect-video w-[118px] shrink-0 overflow-hidden rounded-[10px] tablet:w-[150px]"
          style={
            ep.thumbnailUrl
              ? undefined
              : { backgroundImage: TONE_GRADIENT[tone] }
          }
        >
          {ep.thumbnailUrl && (
            <>
              <Image
                src={ep.thumbnailUrl}
                alt=""
                aria-hidden
                fill
                sizes="(max-width: 834px) 118px, 150px"
                className="object-cover"
              />
              <div
                aria-hidden
                className="duotone pointer-events-none absolute inset-0"
              />
            </>
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-burgundy/80 backdrop-blur-md">
              <Icon name="play" size={11} color="#f6efe4" />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <h3 className="text-[13px] font-bold text-cream tablet:text-sm">
            {ep.number}. {ep.title}
          </h3>
          {ep.description && (
            <p className="line-clamp-2 text-[11px] leading-normal text-cream/55 tablet:text-xs">
              {ep.description}
            </p>
          )}
          <span className="text-[10px] font-semibold text-cream/40">
            {minutes
              ? t.showDetail.minutes(minutes)
              : !playable
                ? t.showDetail.soon
                : ""}
          </span>
        </div>
      </Link>
    </li>
  );
}
