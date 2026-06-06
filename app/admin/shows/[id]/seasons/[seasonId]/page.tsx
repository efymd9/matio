import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import {
  AdminPageHeader,
  EpisodeStatusBadge,
  Field,
  Panel,
} from "@/components/admin/ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EpisodeAccessSelect } from "@/components/admin/access-select";
import { muxThumbnailUrl } from "@/lib/mux-token";
import { createEpisode, deleteEpisode } from "@/app/admin/actions";
import { getAdminDict } from "@/lib/i18n/admin-server";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string }>;
}) {
  const { id, seasonId } = await params;
  const { t } = await getAdminDict();

  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)))
    .limit(1);
  if (!show) notFound();

  const [season] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.id, seasonId), eq(seasons.showId, show.id)))
    .limit(1);
  if (!season) notFound();

  const seasonEpisodes = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      description: episodes.description,
      status: episodes.status,
      access: episodes.access,
      muxAssetId: episodes.muxAssetId,
      muxPlaybackId: episodes.muxPlaybackId,
      muxPlaybackPolicy: episodes.muxPlaybackPolicy,
    })
    .from(episodes)
    .where(eq(episodes.seasonId, season.id))
    .orderBy(asc(episodes.number));

  const readyCount = seasonEpisodes.filter((e) => e.status === "ready").length;

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <AdminPageHeader
        backHref={`/admin/shows/${show.id}`}
        backLabel={show.title}
        kicker={t.season.seasonN(season.number)}
        title={season.title ? season.title : t.season.seasonN(season.number)}
        subtitle={t.season.episodeCountReady(seasonEpisodes.length, readyCount)}
      />

      <Panel
        kicker={t.season.panelKickerContent}
        title={t.season.panelTitleEpisodes}
        right={
          <span className="font-mono text-xs text-white/45">
            {seasonEpisodes.length}
          </span>
        }
      >
        <div className="space-y-2">
          {seasonEpisodes.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-sm text-white/45">
              {t.season.emptyEpisodes}
            </p>
          ) : (
            seasonEpisodes.map((episode) => {
              const editHref = `/admin/shows/${show.id}/seasons/${season.id}/episodes/${episode.id}`;
              let thumb: string | null = null;
              if (episode.status === "ready" && episode.muxPlaybackId) {
                try {
                  thumb = muxThumbnailUrl(
                    episode.muxPlaybackId,
                    episode.muxPlaybackPolicy,
                    { width: 160, height: 90 },
                  );
                } catch {
                  thumb = null;
                }
              }
              return (
                <div
                  key={episode.id}
                  className="group relative flex items-center gap-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
                >
                  {/* Thumbnail (16:9) — raw <img>: signed Mux URL, can't
                      pass next/image remotePatterns at request time. */}
                  <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40 sm:w-28">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        aria-hidden
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold text-white/25">
                        E{episode.number}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-white/45">
                        E{episode.number}
                      </span>
                      <Link
                        href={editHref}
                        className="truncate text-sm font-bold text-white after:absolute after:inset-0 hover:text-[#ff3d3d]"
                      >
                        {episode.title}
                      </Link>
                      <EpisodeStatusBadge
                        status={episode.status}
                        hasAsset={!!episode.muxAssetId}
                      />
                    </div>
                    {episode.description ? (
                      <p className="mt-1 line-clamp-1 text-xs text-white/45">
                        {episode.description}
                      </p>
                    ) : null}
                  </div>

                  <div className="relative z-10 flex shrink-0 items-center gap-2">
                    <EpisodeAccessSelect
                      episodeId={episode.id}
                      seasonId={season.id}
                      showId={show.id}
                      value={episode.access}
                    />
                    <Link
                      href={editHref}
                      className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      {t.season.edit}
                    </Link>
                    <form
                      action={deleteEpisode.bind(null, episode.id, season.id, show.id)}
                    >
                      <ConfirmDeleteButton
                        message={t.season.deleteEpisodeConfirm(
                          episode.number,
                          episode.title,
                        )}
                      >
                        {t.season.delete}
                      </ConfirmDeleteButton>
                    </form>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add episode */}
        <form
          action={createEpisode.bind(null, season.id, show.id)}
          className="mt-5 space-y-4 border-t border-white/[0.06] pt-5"
        >
          <p className="text-sm font-semibold text-white">
            {t.season.addAnEpisode}
          </p>
          <div className="grid gap-4 sm:grid-cols-[90px_1fr]">
            <Field label={t.season.fieldNumber} htmlFor="ep-number" required>
              <Input
                id="ep-number"
                name="number"
                type="number"
                min={1}
                required
                className="text-center"
              />
            </Field>
            <Field label={t.season.fieldTitle} htmlFor="ep-title" required>
              <Input
                id="ep-title"
                name="title"
                required
                placeholder={t.season.episodeTitlePlaceholder}
              />
            </Field>
          </div>
          <Field label={t.season.fieldDescription} htmlFor="ep-description">
            <Textarea
              id="ep-description"
              name="description"
              rows={2}
              placeholder={t.season.descriptionPlaceholder}
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex h-10 items-center gap-1.5 rounded-md bg-[#ff3d3d] px-4 text-sm font-bold text-white shadow-[0_8px_24px_-12px_rgba(255,61,61,0.8)] transition-[filter] hover:brightness-110 active:scale-[0.99]"
            >
              <Icon name="plus" size={15} color="#ffffff" />
              {t.season.addEpisodeButton}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
