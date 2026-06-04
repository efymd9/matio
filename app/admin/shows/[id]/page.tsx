import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { seasons, shows } from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { ShowForm } from "@/components/admin/show-form";
import { Input } from "@/components/ui/input";
import {
  createSeason,
  deleteSeason,
  setFeaturedShow,
  softDeleteShow,
  unsetFeaturedShow,
  updateShow,
} from "@/app/admin/actions";

export default async function EditShowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  const isPublished = show.status === "published";

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      {/* Header */}
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white"
        >
          <Icon name="back" size={14} />
          Shows
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-3xl font-extrabold tracking-tight text-white">
                {show.title}
              </h1>
              <StatusPill status={show.status} />
              {show.featured ? <FeaturedPill /> : null}
            </div>
            <p className="mt-1 font-mono text-xs text-white/45">/{show.slug}</p>
          </div>
          {isPublished ? (
            <Link
              href={`/shows/${show.slug}`}
              target="_blank"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 px-3.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              View on site
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
          justReleased: show.justReleased,
          popularNow: show.popularNow,
        }}
      />

      {/* Home hero feature toggle */}
      <Panel kicker="Home hero" title="Featured show">
        {show.featured ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/65">
              This show is the home-page hero. Only one show can hold the
              hero at a time.
            </p>
            <form action={unsetFeaturedShow.bind(null, show.id)}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-white/15 px-4 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Remove from hero
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-white/65">
              {isPublished
                ? "Promote this show to the home-page hero. The current hero will be unfeatured."
                : "Publish the show first — only published shows can be featured."}
            </p>
            <form action={setFeaturedShow.bind(null, show.id)}>
              <button
                type="submit"
                disabled={!isPublished}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#ff3d3d] px-4 text-sm font-bold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="star" size={14} color="#ffffff" />
                Feature on home
              </button>
            </form>
          </div>
        )}
      </Panel>

      {/* Seasons */}
      <Panel
        kicker="Content"
        title="Seasons"
        right={
          <span className="font-mono text-xs text-white/45">
            {showSeasons.length} {showSeasons.length === 1 ? "season" : "seasons"}
          </span>
        }
      >
        <div className="space-y-2">
          {showSeasons.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-sm text-white/45">
              No seasons yet. Add the first one below.
            </p>
          ) : (
            showSeasons.map((season) => (
              <div
                key={season.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-4 py-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.06] font-mono text-sm font-bold text-white">
                  {season.number}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-white/85">
                  <span className="font-semibold text-white">
                    Season {season.number}
                  </span>
                  {season.title ? (
                    <span className="text-white/55"> · {season.title}</span>
                  ) : null}
                </span>
                <Link
                  href={`/admin/shows/${show.id}/seasons/${season.id}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  Episodes
                  <Icon name="chevron-right" size={13} />
                </Link>
                <form action={deleteSeason.bind(null, season.id, show.id)}>
                  <ConfirmDeleteButton
                    message={`Delete Season ${season.number}? All its episodes will also be removed.`}
                  >
                    Delete
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
            placeholder="#"
            required
            className="w-16 text-center"
            aria-label="Season number"
          />
          <Input
            name="title"
            placeholder="Title (optional)"
            className="flex-1"
            aria-label="Season title"
          />
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="plus" size={14} color="#0a0a0c" />
            Add
          </button>
        </form>
      </Panel>

      {/* Danger zone */}
      <section className="rounded-2xl border border-[#ff3d3d]/25 bg-[#ff3d3d]/[0.04] p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          Danger zone
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-white/65">
            Deleting removes this show from the catalog. Seasons and episodes
            go with it.
          </p>
          <form action={softDeleteShow.bind(null, show.id)}>
            <ConfirmDeleteButton
              message={`Delete "${show.title}"? This cannot be undone.`}
            >
              Delete this show
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
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            {kicker}
          </p>
          <h2 className="mt-1 text-base font-bold tracking-tight text-white">
            {title}
          </h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: "draft" | "published" }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${
        status === "published"
          ? "bg-[#7fd87a]/15 text-[#7fd87a]"
          : "bg-white/10 text-white/65"
      }`}
    >
      {status}
    </span>
  );
}

function FeaturedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#ff3d3d]/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#ff3d3d]">
      <Icon name="star" size={10} color="#ff3d3d" />
      Featured
    </span>
  );
}
