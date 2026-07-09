import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actors, showActors, shows } from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { ActorForm } from "@/components/admin/actor-form";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { deleteActor, updateActor } from "@/app/admin/actions";

export default async function EditActorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { t } = await getAdminDict();

  const [actor] = await db
    .select()
    .from(actors)
    .where(eq(actors.id, id))
    .limit(1);

  if (!actor) notFound();

  // Where this actor appears — soft-deleted shows included deliberately so
  // the admin can see (and un-delete-era rows don't silently vanish here);
  // the public surfaces filter on published themselves.
  const appearances = await db
    .select({
      showId: shows.id,
      title: shows.title,
      status: shows.status,
      characterName: showActors.characterName,
    })
    .from(showActors)
    .innerJoin(shows, eq(showActors.showId, shows.id))
    .where(eq(showActors.actorId, actor.id))
    .orderBy(asc(shows.title));

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      {/* Header */}
      <div>
        <Link
          href="/admin/actors"
          className="inline-flex items-center gap-1.5 text-sm text-cream/50 transition-colors hover:text-cream"
        >
          <Icon name="back" size={14} />
          {t.actorEdit.backToActors}
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-cream">
              {actor.name}
            </h1>
            <p className="mt-1 font-mono text-xs text-cream/45">
              /actors/{actor.slug}
            </p>
          </div>
          <Link
            href={`/actors/${actor.slug}`}
            target="_blank"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/15 px-3.5 text-sm font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
          >
            {t.actorEdit.viewOnSite}
            <Icon name="chevron-right" size={14} />
          </Link>
        </div>
      </div>

      <ActorForm
        action={updateActor.bind(null, actor.id)}
        mode="edit"
        defaultValues={{
          name: actor.name,
          slug: actor.slug,
          tagline: actor.tagline ?? "",
          bio: actor.bio ?? "",
          avatarImageUrl: actor.avatarImageUrl ?? "",
        }}
      />

      {/* Appearances */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {t.actorEdit.appearsInKicker}
        </p>
        <h2 className="mt-1 text-base font-bold tracking-tight text-cream">
          {t.actorEdit.appearsInTitle}
        </h2>
        <div className="mt-4 space-y-2">
          {appearances.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 py-6 text-center text-sm text-cream/45">
              {t.actorEdit.noAppearances}
            </p>
          ) : (
            appearances.map((a) => (
              <div
                key={a.showId}
                className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-black/20 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-cream/85">
                  <span className="font-semibold text-cream">{a.title}</span>
                  {a.characterName ? (
                    <span className="text-cream/55">
                      {" "}
                      · {t.actorEdit.asCharacter(a.characterName)}
                    </span>
                  ) : null}
                </span>
                {a.status !== "published" ? (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-cream/65">
                    {t.showEdit.statusDraft}
                  </span>
                ) : null}
                <Link
                  href={`/admin/shows/${a.showId}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                >
                  {t.actorsList.edit}
                  <Icon name="chevron-right" size={13} />
                </Link>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-2xl border border-rust/25 bg-rust/[0.06] p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-rust">
          {t.showEdit.dangerZone}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-cream/65">
            {t.actorEdit.deleteActorDescription}
          </p>
          <form action={deleteActor.bind(null, actor.id)}>
            <ConfirmDeleteButton
              message={t.actorEdit.deleteConfirm(actor.name)}
            >
              {t.actorEdit.deleteThisActor}
            </ConfirmDeleteButton>
          </form>
        </div>
      </section>
    </div>
  );
}
