import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actors,
  episodes,
  seasons,
  showActors,
  showReminders,
  shows,
} from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { RemindersPanel } from "@/components/admin/reminders-panel";
import { ShowForm } from "@/components/admin/show-form";
import { Input } from "@/components/ui/input";
import { resendConfigured } from "@/lib/resend";
import { getAdminDict } from "@/lib/i18n/admin-server";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";
import {
  addActorToShow,
  createSeason,
  deleteSeason,
  moveCastMember,
  removeActorFromShow,
  setFeaturedShow,
  softDeleteShow,
  unsetFeaturedShow,
  updateCastCharacter,
  updateShow,
} from "@/app/admin/actions";

export default async function EditShowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t } = await getAdminDict();

  const [show] = await db
    .select()
    .from(shows)
    .where(and(eq(shows.id, id), isNull(shows.deletedAt)))
    .limit(1);

  if (!show) notFound();

  const showSeasons = await db
    .select()
    .from(seasons)
    .where(eq(seasons.showId, show.id))
    .orderBy(asc(seasons.number));

  // Cast in admin-set display order; (position, name) so legacy position
  // ties stay stable. Same ordering rule the public show page uses.
  const cast = await db
    .select({
      actorId: actors.id,
      name: actors.name,
      tagline: actors.tagline,
      avatarImageUrl: actors.avatarImageUrl,
      characterName: showActors.characterName,
    })
    .from(showActors)
    .innerJoin(actors, eq(showActors.actorId, actors.id))
    .where(eq(showActors.showId, show.id))
    .orderBy(asc(showActors.position), asc(actors.name));

  const castIds = cast.map((c) => c.actorId);
  const availableActors = await db
    .select({ id: actors.id, name: actors.name })
    .from(actors)
    .where(castIds.length ? notInArray(actors.id, castIds) : undefined)
    .orderBy(asc(actors.name));

  // Reminder backlog for the "Episode reminders" panel: how many
  // addresses still wait for an email vs. already got one.
  const [reminderCounts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${showReminders.notifiedAt} is null)`.mapWith(
        Number,
      ),
      sent: sql<number>`count(*) filter (where ${showReminders.notifiedAt} is not null)`.mapWith(
        Number,
      ),
    })
    .from(showReminders)
    .where(eq(showReminders.showId, show.id));

  // Ready episodes for the announce picker, newest first (the default
  // selection should be the episode that just dropped).
  const readyEpisodes = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      seasonNumber: seasons.number,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(and(eq(seasons.showId, show.id), eq(episodes.status, "ready")))
    .orderBy(desc(seasons.number), desc(episodes.number));

  const isPublished = show.status === "published";

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      {/* Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-cream/50 transition-colors hover:text-cream"
        >
          <Icon name="back" size={14} />
          {t.showEdit.backToShows}
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-3xl font-extrabold tracking-tight text-cream">
                {show.title}
              </h1>
              <StatusPill status={show.status} t={t} />
              {show.featured ? <FeaturedPill t={t} /> : null}
            </div>
            <p className="mt-1 font-mono text-xs text-cream/45">/{show.slug}</p>
          </div>
          {isPublished ? (
            <Link
              href={`/shows/${show.slug}`}
              target="_blank"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 px-3.5 text-sm font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
            >
              {t.showEdit.viewOnSite}
              <Icon name="chevron-right" size={14} />
            </Link>
          ) : null}
        </div>
      </div>

      {/* Details / artwork / visibility — unified form */}
      <ShowForm
        action={updateShow.bind(null, show.id)}
        mode="edit"
        defaultValues={{
          title: show.title,
          slug: show.slug,
          description: show.description ?? "",
          posterImageUrl: show.posterImageUrl ?? "",
          heroImageUrl: show.heroImageUrl ?? "",
          genre: show.genre.join(", "),
          status: show.status,
          orientation: show.orientation,
          justReleased: show.justReleased,
          popularNow: show.popularNow,
        }}
      />

      {/* Home hero feature toggle */}
      <Panel kicker={t.showEdit.homeHeroKicker} title={t.showEdit.featuredShowTitle}>
        {show.featured ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-cream/65">
              {t.showEdit.heroCurrentDescription}
            </p>
            <form action={unsetFeaturedShow.bind(null, show.id)}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-white/15 px-4 text-sm font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
              >
                {t.showEdit.removeFromHero}
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-cream/65">
              {isPublished
                ? t.showEdit.heroPromoteDescription
                : t.showEdit.heroPublishFirstDescription}
            </p>
            <form action={setFeaturedShow.bind(null, show.id)}>
              <button
                type="submit"
                disabled={!isPublished}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gold-cta px-4 text-sm font-bold text-gold-deep transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="star" size={14} color="#241205" />
                {t.showEdit.featureOnHome}
              </button>
            </form>
          </div>
        )}
      </Panel>

      {/* Seasons */}
      <Panel
        kicker={t.showEdit.contentKicker}
        title={t.showEdit.seasonsTitle}
        right={
          <span className="font-mono text-xs text-cream/45">
            {t.showEdit.seasonCount(showSeasons.length)}
          </span>
        }
      >
        <div className="space-y-2">
          {showSeasons.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-sm text-cream/45">
              {t.showEdit.noSeasonsEmptyState}
            </p>
          ) : (
            showSeasons.map((season) => (
              <div
                key={season.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-4 py-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.06] font-mono text-sm font-bold text-cream">
                  {season.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-cream/85">
                  <span className="font-semibold text-cream">
                    {t.showEdit.seasonLabel(season.number)}
                  </span>
                  {season.title ? (
                    <span className="text-cream/55"> · {season.title}</span>
                  ) : null}
                </span>
                <Link
                  href={`/admin/shows/${show.id}/seasons/${season.id}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                >
                  {t.showEdit.episodes}
                  <Icon name="chevron-right" size={13} />
                </Link>
                <form action={deleteSeason.bind(null, season.id, show.id)}>
                  <ConfirmDeleteButton
                    message={t.showEdit.deleteSeasonConfirm(season.number)}
                  >
                    {t.showEdit.delete}
                  </ConfirmDeleteButton>
                </form>
              </div>
            ))
          )}
        </div>

        <form
          action={createSeason.bind(null, show.id)}
          className="mt-4 flex gap-2 border-t border-white/[0.06] pt-4"
        >
          <Input
            name="number"
            type="number"
            min={1}
            placeholder={t.showEdit.seasonNumberPlaceholder}
            required
            className="w-16 text-center"
            aria-label={t.showEdit.seasonNumberAria}
          />
          <Input
            name="title"
            placeholder={t.showEdit.seasonTitlePlaceholder}
            className="flex-1"
            aria-label={t.showEdit.seasonTitleAria}
          />
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="plus" size={14} color="#0f0a07" />
            {t.showEdit.add}
          </button>
        </form>
      </Panel>

      {/* Virtual actors (cast) */}
      <Panel
        kicker={t.showEdit.castKicker}
        title={t.showEdit.castTitle}
        right={
          <span className="font-mono text-xs text-cream/45">
            {t.showEdit.castCount(cast.length)}
          </span>
        }
      >
        <div className="space-y-2">
          {cast.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-sm text-cream/45">
              {t.showEdit.noCastYet}
            </p>
          ) : (
            cast.map((member, i) => (
              <div
                key={member.actorId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-4 py-3"
              >
                <div className="relative size-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/40">
                  {member.avatarImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={member.avatarImageUrl}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-cream/25">
                      {member.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/actors/${member.actorId}`}
                    className="text-sm font-semibold text-cream hover:text-gold"
                  >
                    {member.name}
                  </Link>
                  {member.tagline ? (
                    <p className="truncate text-[11px] text-cream/45">
                      {member.tagline}
                    </p>
                  ) : null}
                </div>
                {/* Per-row character-name form: submits on blur-away via the
                    save button; separate from the reorder/remove forms. */}
                <form
                  action={updateCastCharacter.bind(
                    null,
                    show.id,
                    member.actorId,
                  )}
                  className="flex items-center gap-2"
                >
                  <Input
                    name="characterName"
                    defaultValue={member.characterName ?? ""}
                    placeholder={t.showEdit.characterPlaceholder}
                    aria-label={t.showEdit.characterAria(member.name)}
                    className="h-8 w-44 text-xs"
                  />
                  <button
                    type="submit"
                    className="inline-flex h-8 items-center rounded-md border border-white/15 px-2.5 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                  >
                    {t.showEdit.saveCharacter}
                  </button>
                </form>
                <div className="flex items-center gap-1">
                  <form
                    action={moveCastMember.bind(
                      null,
                      show.id,
                      member.actorId,
                      "up",
                    )}
                  >
                    <button
                      type="submit"
                      disabled={i === 0}
                      aria-label={t.showEdit.moveUpAria(member.name)}
                      className="inline-flex size-8 items-center justify-center rounded-md border border-white/15 text-cream/70 transition-colors hover:bg-white/[0.06] hover:text-cream disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <span aria-hidden className="text-xs">↑</span>
                    </button>
                  </form>
                  <form
                    action={moveCastMember.bind(
                      null,
                      show.id,
                      member.actorId,
                      "down",
                    )}
                  >
                    <button
                      type="submit"
                      disabled={i === cast.length - 1}
                      aria-label={t.showEdit.moveDownAria(member.name)}
                      className="inline-flex size-8 items-center justify-center rounded-md border border-white/15 text-cream/70 transition-colors hover:bg-white/[0.06] hover:text-cream disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <span aria-hidden className="text-xs">↓</span>
                    </button>
                  </form>
                </div>
                <form
                  action={removeActorFromShow.bind(
                    null,
                    show.id,
                    member.actorId,
                  )}
                >
                  <ConfirmDeleteButton
                    message={t.showEdit.removeCastConfirm(member.name)}
                  >
                    {t.showEdit.removeFromCast}
                  </ConfirmDeleteButton>
                </form>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 border-t border-white/[0.06] pt-4">
          {availableActors.length === 0 ? (
            <p className="text-xs text-cream/45">
              {cast.length === 0
                ? t.showEdit.noActorsExistHint
                : t.showEdit.allActorsAdded}{" "}
              <Link
                href="/admin/actors"
                className="font-semibold text-gold hover:brightness-110"
              >
                {t.showEdit.manageActorsLink}
              </Link>
            </p>
          ) : (
            <form
              action={addActorToShow.bind(null, show.id)}
              className="flex flex-wrap items-center gap-2"
            >
              {/* Native <select>: this panel is server-rendered (no client
                  state), and a styled native control beats pulling the
                  client Select in for a plain form post. */}
              <select
                name="actorId"
                required
                defaultValue=""
                aria-label={t.showEdit.selectActorAria}
                className="h-8 rounded-md border border-white/15 bg-black/40 px-2.5 text-xs font-semibold text-cream/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              >
                <option value="" disabled>
                  {t.showEdit.selectActorPlaceholder}
                </option>
                {availableActors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Input
                name="characterName"
                placeholder={t.showEdit.characterPlaceholder}
                aria-label={t.showEdit.characterAddAria}
                className="h-8 w-44 text-xs"
              />
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90"
              >
                <Icon name="plus" size={14} color="#0f0a07" />
                {t.showEdit.addToCast}
              </button>
              <Link
                href="/admin/actors"
                className="ml-auto text-xs font-semibold text-gold hover:brightness-110"
              >
                {t.showEdit.manageActorsLink}
              </Link>
            </form>
          )}
        </div>
      </Panel>

      {/* Episode reminders — dispatch the show_reminders backlog */}
      <Panel
        kicker={t.reminders.kicker}
        title={t.reminders.title}
        right={
          <span className="font-mono text-xs text-cream/45">
            {t.reminders.pendingBadge(reminderCounts?.pending ?? 0)}
          </span>
        }
      >
        <RemindersPanel
          showId={show.id}
          isPublished={isPublished}
          configured={resendConfigured()}
          pendingCount={reminderCounts?.pending ?? 0}
          sentCount={reminderCounts?.sent ?? 0}
          episodes={readyEpisodes.map((ep) => ({
            id: ep.id,
            label: t.reminders.episodeOption(
              ep.seasonNumber,
              ep.number,
              ep.title,
            ),
          }))}
        />
      </Panel>

      {/* Danger zone */}
      <section className="rounded-2xl border border-rust/25 bg-rust/[0.06] p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-rust">
          {t.showEdit.dangerZone}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-cream/65">
            {t.showEdit.deleteShowDescription}
          </p>
          <form action={softDeleteShow.bind(null, show.id)}>
            <ConfirmDeleteButton
              message={t.showEdit.deleteShowConfirm(show.title)}
            >
              {t.showEdit.deleteThisShow}
            </ConfirmDeleteButton>
          </form>
        </div>
      </section>
    </div>
  );
}

function Panel({
  kicker,
  title,
  right,
  children,
}: {
  kicker: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {kicker}
          </p>
          <h2 className="mt-1 text-base font-bold tracking-tight text-cream">
            {title}
          </h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: "draft" | "published";
  t: AdminDict;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${
        status === "published"
          ? "bg-[#7fd87a]/15 text-[#7fd87a]"
          : "bg-white/10 text-cream/65"
      }`}
    >
      {status === "published"
        ? t.showEdit.statusPublished
        : t.showEdit.statusDraft}
    </span>
  );
}

function FeaturedPill({ t }: { t: AdminDict }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-gold">
      <Icon name="star" size={10} color="#e6b366" />
      {t.showEdit.featured}
    </span>
  );
}
