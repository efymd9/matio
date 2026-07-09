import Link from "next/link";
import { asc, count } from "drizzle-orm";
import { db } from "@/db";
import { actors, showActors } from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { deleteActor } from "@/app/admin/actions";

export default async function AdminActorsPage() {
  const { t } = await getAdminDict();
  const [all, showCounts] = await Promise.all([
    db.select().from(actors).orderBy(asc(actors.name)),
    db
      .select({ actorId: showActors.actorId, n: count() })
      .from(showActors)
      .groupBy(showActors.actorId),
  ]);

  const showCountByActor = new Map(
    showCounts.map((r) => [r.actorId, Number(r.n)]),
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {t.actorsList.eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-cream">
            {t.actorsList.title}
          </h1>
          <p className="mt-1 text-sm text-cream/55">
            {t.actorsList.total(all.length)}
          </p>
        </div>
        <Link
          href="/admin/actors/new"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gold-cta px-4 text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[filter] hover:brightness-110"
        >
          <Icon name="plus" size={15} color="#241205" />
          {t.actorsList.newActor}
        </Link>
      </div>

      {all.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          <p className="text-sm text-cream/55">{t.actorsList.noActorsYet}</p>
          <Link
            href="/admin/actors/new"
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="plus" size={14} color="#0f0a07" />
            {t.actorsList.createFirstActor}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {all.map((actor) => (
            <li
              key={actor.id}
              className="group relative flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
            >
              {/* Avatar thumbnail — raw <img>: admin-entered arbitrary
                  URL, can't pass next/image remotePatterns. */}
              <div className="relative size-12 shrink-0 overflow-hidden rounded-full border border-white/10 bg-black/40">
                {actor.avatarImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={actor.avatarImageUrl}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-cream/25">
                    {actor.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/actors/${actor.id}`}
                    className="truncate text-sm font-bold text-cream after:absolute after:inset-0 hover:text-gold"
                  >
                    {actor.name}
                  </Link>
                  {actor.tagline ? (
                    <span className="truncate text-xs text-cream/50">
                      {actor.tagline}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-cream/45">
                  <span>/{actor.slug}</span>
                  <span className="text-cream/25">·</span>
                  <span>
                    {t.actorsList.showCount(showCountByActor.get(actor.id) ?? 0)}
                  </span>
                </div>
              </div>

              <div className="relative z-10 flex shrink-0 items-center gap-2">
                <Link
                  href={`/admin/actors/${actor.id}`}
                  className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                >
                  {t.actorsList.edit}
                </Link>
                <form action={deleteActor.bind(null, actor.id)}>
                  <ConfirmDeleteButton
                    message={t.actorsList.deleteConfirm(actor.name)}
                  >
                    {t.actorsList.delete}
                  </ConfirmDeleteButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
