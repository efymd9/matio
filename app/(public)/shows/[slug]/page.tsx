import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { muxThumbnailUrl } from "@/lib/mux-token";
import { getDict } from "@/lib/i18n/server";
import type { Dict } from "@/lib/i18n/dictionaries";
import { ViewContentPixel } from "@/components/site/view-content-pixel";

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
  const { t } = await getDict();
  if (!show) return { title: t.showDetail.notFound };
  const image = show.heroImageUrl ?? show.posterImageUrl ?? null;
  return {
    title: show.title,
    description: show.description ?? undefined,
    openGraph: {
      type: "video.tv_show",
      title: show.title,
      description: show.description ?? undefined,
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: show.title,
      description: show.description ?? undefined,
      images: image ? [image] : undefined,
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
  thumbnailUrl: string | null;
};
import { Icon } from "@/components/site/icon";
import { TONE_GRADIENT, toneFor } from "@/lib/design";

export default async function ShowDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { t } = await getDict();

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

  return (
    <main className="bg-background">
      {/* Meta Pixel ViewContent — renders nothing; fires once the consent-
          gated pixel has loaded. */}
      <ViewContentPixel
        slug={show.slug}
        title={show.title}
        genre={show.genre[0] ?? null}
      />
      {/* Hero */}
      <section className="relative isolate h-[65vh] min-h-[480px] w-full overflow-hidden">
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
          className="pointer-events-none absolute inset-0 opacity-45"
          aria-hidden
          style={{
            backgroundImage:
              "radial-gradient(circle at 50% 30%, rgba(255,255,255,0.22), transparent 55%), radial-gradient(circle at 80% 80%, rgba(0,0,0,0.5), transparent 60%)",
          }}
        />
        {/* Bottom fade pulls the hero into the page bg */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-background via-background/70 to-transparent" />
      </section>

      {/* Title block — overlaps the hero by pulling negative margin up. */}
      <section className="relative z-10 -mt-48 px-6 pb-12 sm:px-12">
        <div className="mx-auto max-w-5xl space-y-5">
          <h1 className="text-5xl font-extrabold leading-[0.95] tracking-[-0.02em] text-white sm:text-6xl">
            {show.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-white/75">
            <span className="font-semibold text-[#7fd87a]">{t.showDetail.matchValue}</span>
            <span>{new Date(show.createdAt).getFullYear()}</span>
            <span className="rounded-[3px] border border-white/30 px-1.5 py-px text-[10px] font-medium uppercase">
              {t.showDetail.ageRating}
            </span>
            {totalEpisodes > 0 && (
              <span>{t.showDetail.episodeCount(totalEpisodes)}</span>
            )}
            <span className="rounded-[3px] border border-white/30 px-1.5 py-px text-[10px] font-medium uppercase">
              {t.showDetail.quality}
            </span>
          </div>

          {totalEpisodes > 0 && (
            <div className="flex flex-col gap-2 pt-1 sm:max-w-md">
              <Link
                href={`/watch/${show.slug}`}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-bold text-black transition-colors hover:bg-white/90"
              >
                <Icon name="play" size={18} color="#0a0a0c" />
                {t.showDetail.play}
              </Link>
            </div>
          )}

          {show.description && (
            <p className="max-w-3xl text-sm leading-relaxed text-white/85 sm:text-base">
              {show.description}
            </p>
          )}

          {show.genre.length > 0 && (
            <p className="text-[11px] text-white/55 leading-relaxed">
              <span className="text-white/40">{t.showDetail.genreLabel}</span>
              <span className="capitalize">{show.genre.join(" · ")}</span>
            </p>
          )}

          {/* Tabs */}
          <div className="flex gap-6 border-b border-white/10 pt-2 text-sm font-semibold">
            <span className="border-b-2 border-[#ff3d3d] pb-3 text-white">
              {t.showDetail.tabEpisodes}
            </span>
          </div>
        </div>
      </section>

      {/* Episodes */}
      <section className="mx-auto max-w-5xl px-6 pb-16 sm:px-12 sm:pb-20">
        {showSeasons.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-2xl font-bold text-white/50">
              {t.showDetail.noEpisodesYetHeader}
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {showSeasons.map((season) => {
              const eps = episodesBySeason.get(season.id) ?? [];
              return (
                <div key={season.id} className="space-y-4">
                  <div className="flex items-center justify-between rounded-md bg-white/[0.06] px-4 py-3">
                    <div className="flex items-baseline gap-3">
                      <h2 className="text-sm font-bold text-white">
                        {t.showDetail.season(season.number)}
                      </h2>
                      {season.title && (
                        <span className="text-xs text-white/60">
                          {season.title}
                        </span>
                      )}
                    </div>
                    <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.6)" />
                  </div>
                  {eps.length === 0 ? (
                    <p className="text-sm text-white/55">{t.showDetail.noEpisodesYetLine}</p>
                  ) : (
                    <ul className="space-y-2">
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
        )}
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

  return (
    <li>
      <Link
        href={playable ? `/watch/${showSlug}` : "#"}
        aria-disabled={!playable}
        tabIndex={playable ? 0 : -1}
        className={`group flex items-start gap-4 rounded-lg p-3 transition-colors ${
          playable ? "hover:bg-white/[0.04]" : "cursor-default opacity-70"
        }`}
      >
        {/* Thumbnail — real signed Mux still if the asset is ready,
            tone-gradient placeholder otherwise. */}
        <div
          className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-md sm:w-40"
          style={
            ep.thumbnailUrl
              ? undefined
              : { backgroundImage: TONE_GRADIENT[tone] }
          }
        >
          {ep.thumbnailUrl ? (
            <Image
              src={ep.thumbnailUrl}
              alt=""
              aria-hidden
              fill
              sizes="(max-width: 640px) 128px, 160px"
              className="object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 opacity-30"
              aria-hidden
              style={{
                backgroundImage:
                  "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.25), transparent 60%)",
              }}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 backdrop-blur-md">
              <Icon name="play" size={12} color="#ffffff" />
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-white sm:text-base">
              {ep.number}. {ep.title}
            </h3>
            <span className="shrink-0 text-[11px] text-white/55">
              {minutes
                ? t.showDetail.minutes(minutes)
                : !playable
                  ? t.showDetail.soon
                  : ""}
            </span>
          </div>
          {ep.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/60">
              {ep.description}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}
