import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { FormSubmitButton } from "@/components/admin/form-submit-button";
import { UploadWidget } from "@/components/admin/upload-widget";
import {
  AdminPageHeader,
  DangerPanel,
  EpisodeStatusBadge,
  Field,
  Panel,
} from "@/components/admin/ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AccessFormSelect } from "@/components/admin/access-select";
import { muxThumbnailUrl } from "@/lib/mux-token";
import { deleteEpisode, updateEpisode } from "@/app/admin/actions";
import { getAdminDict } from "@/lib/i18n/admin-server";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default async function EditEpisodePage({
  params,
}: {
  params: Promise<{ id: string; seasonId: string; episodeId: string }>;
}) {
  const { id, seasonId, episodeId } = await params;
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

  const [episode] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      description: episodes.description,
      durationSeconds: episodes.durationSeconds,
      muxAssetId: episodes.muxAssetId,
      muxPlaybackId: episodes.muxPlaybackId,
      muxPlaybackPolicy: episodes.muxPlaybackPolicy,
      status: episodes.status,
      access: episodes.access,
      introStartSeconds: episodes.introStartSeconds,
      introEndSeconds: episodes.introEndSeconds,
    })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.seasonId, season.id)))
    .limit(1);
  if (!episode) notFound();

  let previewThumb: string | null = null;
  if (episode.status === "ready" && episode.muxPlaybackId) {
    try {
      previewThumb = muxThumbnailUrl(
        episode.muxPlaybackId,
        episode.muxPlaybackPolicy,
        { width: 640, height: 360 },
      );
    } catch {
      previewThumb = null;
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <AdminPageHeader
        backHref={`/admin/shows/${show.id}/seasons/${season.id}`}
        backLabel={t.episode.backLabelSeason(show.title, season.number)}
        kicker={t.episode.kickerSeasonEpisode(season.number, episode.number)}
        title={episode.title}
        pills={
          <EpisodeStatusBadge
            status={episode.status}
            hasAsset={!!episode.muxAssetId}
          />
        }
      />

      {/* Video */}
      <Panel
        kicker={t.episode.videoKicker}
        title={
          episode.muxAssetId ? t.episode.replaceVideo : t.episode.uploadVideo
        }
        hint={t.episode.videoUploadHint}
      >
        <div className="space-y-5">
          {/* Preview frame + metadata */}
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-black/40">
              {previewThumb ? (
                /* Preview frame — raw <img>: signed Mux thumbnail URL can't
                   pass next/image remotePatterns at request time. Decorative
                   (title + metadata sit alongside as text), so aria-hidden. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewThumb}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-center">
                  <span className="font-mono text-lg font-bold text-white/25">
                    E{episode.number}
                  </span>
                  <span className="text-[11px] text-white/35">
                    {episode.muxAssetId
                      ? t.episode.noPreviewYet
                      : t.episode.noVideo}
                  </span>
                </div>
              )}
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 self-start text-sm">
              <MetaRow label={t.episode.metaStatus}>
                <EpisodeStatusBadge
                  status={episode.status}
                  hasAsset={!!episode.muxAssetId}
                />
              </MetaRow>
              <MetaRow label={t.episode.metaDuration}>
                <span className="text-white/80">
                  {formatDuration(episode.durationSeconds)}
                </span>
              </MetaRow>
              <MetaRow label={t.episode.metaAssetId}>
                <span className="break-all font-mono text-[11px] text-white/55">
                  {episode.muxAssetId ?? "—"}
                </span>
              </MetaRow>
              <MetaRow label={t.episode.metaPlaybackId}>
                <span className="break-all font-mono text-[11px] text-white/55">
                  {episode.muxPlaybackId ?? "—"}
                </span>
              </MetaRow>
            </dl>
          </div>

          <div className="border-t border-white/[0.06] pt-5">
            <UploadWidget episodeId={episode.id} />
          </div>
        </div>
      </Panel>

      {/* Details */}
      <Panel kicker={t.episode.detailsKicker} title={t.episode.episodeInfo}>
        <form
          action={updateEpisode.bind(null, episode.id, season.id, show.id)}
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
            <Field label={t.episode.fieldNumber} htmlFor="number" required>
              <Input
                id="number"
                name="number"
                type="number"
                min={1}
                defaultValue={episode.number}
                required
                className="text-center"
              />
            </Field>
            <Field label={t.episode.fieldTitle} htmlFor="title" required>
              <Input
                id="title"
                name="title"
                defaultValue={episode.title}
                required
              />
            </Field>
          </div>
          <Field label={t.episode.fieldDescription} htmlFor="description">
            <Textarea
              id="description"
              name="description"
              defaultValue={episode.description ?? ""}
              rows={4}
            />
          </Field>

          <Field
            label={t.accessSelect.whoCanWatch}
            hint={t.accessSelect.whoCanWatchHint}
          >
            <AccessFormSelect name="access" defaultValue={episode.access} />
          </Field>

          {/* Skip-intro markers */}
          <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-white">
                {t.episode.skipIntro}
              </p>
              <span className="text-[11px] text-white/45">
                {t.episode.skipIntroBlankHint}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field
                label={t.episode.fieldStart}
                htmlFor="introStartSeconds"
                hint={t.episode.secondsHint}
              >
                <Input
                  id="introStartSeconds"
                  name="introStartSeconds"
                  type="number"
                  min={0}
                  step={1}
                  placeholder={t.episode.skipIntroPlaceholderStart}
                  defaultValue={episode.introStartSeconds ?? ""}
                />
              </Field>
              <Field
                label={t.episode.fieldEnd}
                htmlFor="introEndSeconds"
                hint={t.episode.secondsHint}
              >
                <Input
                  id="introEndSeconds"
                  name="introEndSeconds"
                  type="number"
                  min={1}
                  step={1}
                  placeholder={t.episode.skipIntroPlaceholderEnd}
                  defaultValue={episode.introEndSeconds ?? ""}
                />
              </Field>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-white/45">
              {t.episode.skipIntroExplain}
            </p>
          </div>

          <div className="flex justify-end">
            <FormSubmitButton
              icon="check"
              pendingLabel={t.episode.savingPending}
            >
              {t.episode.saveChanges}
            </FormSubmitButton>
          </div>
        </form>
      </Panel>

      {/* Danger zone */}
      <DangerPanel description={t.episode.deleteDescription}>
        <form action={deleteEpisode.bind(null, episode.id, season.id, show.id)}>
          <ConfirmDeleteButton
            message={t.episode.deleteConfirm(episode.number, episode.title)}
          >
            {t.episode.deleteThisEpisode}
          </ConfirmDeleteButton>
        </form>
      </DangerPanel>
    </div>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-white/45">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
