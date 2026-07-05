import Link from "next/link";
import { count, desc, isNull } from "drizzle-orm";
import { db } from "@/db";
import { seasons, shows } from "@/db/schema";
import { Icon } from "@/components/site/icon";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { softDeleteShow } from "./actions";

export default async function AdminShowsPage() {
  const { t } = await getAdminDict();
  const [all, seasonCounts] = await Promise.all([
    db.select().from(shows).where(isNull(shows.deletedAt)).orderBy(desc(shows.updatedAt)),
    db
      .select({ showId: seasons.showId, n: count() })
      .from(seasons)
      .groupBy(seasons.showId),
  ]);

  const seasonCountByShow = new Map(
    seasonCounts.map((r) => [r.showId, Number(r.n)]),
  );
  const published = all.filter((s) => s.status === "published").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {t.showsList.eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-cream">
            {t.showsList.title}
          </h1>
          <p className="mt-1 text-sm text-cream/55">
            {t.showsList.totalAndPublished(all.length, published)}
          </p>
        </div>
        <Link
          href="/admin/shows/new"
          className="inline-flex h-10 items-center gap-1.5 rounded-full bg-gold-cta px-4 text-sm font-bold text-gold-deep shadow-[0_16px_40px_-14px_rgba(230,179,102,0.5)] transition-[filter] hover:brightness-110"
        >
          <Icon name="plus" size={15} color="#241205" />
          {t.showsList.newShow}
        </Link>
      </div>

      {all.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          <p className="text-sm text-cream/55">{t.showsList.noShowsYet}</p>
          <Link
            href="/admin/shows/new"
            className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-bold text-black transition-colors hover:bg-white/90"
          >
            <Icon name="plus" size={14} color="#0f0a07" />
            {t.showsList.createFirstShow}
          </Link>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {all.map((show) => {
            const seasonN = seasonCountByShow.get(show.id) ?? 0;
            return (
              <li
                key={show.id}
                className="group relative flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
              >
                {/* Poster thumbnail — raw <img>: admin-entered arbitrary
                    URL, can't pass next/image remotePatterns. */}
                <div className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
                  {show.posterImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={show.posterImageUrl}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-cream/25">
                      {show.title.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Title + meta. The stretched link makes the whole row
                    open the editor; the delete button sits above it via
                    z-10 so it stays independently clickable. */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/shows/${show.id}`}
                      className="truncate text-sm font-bold text-cream after:absolute after:inset-0 hover:text-gold"
                    >
                      {show.title}
                    </Link>
                    <StatusPill
                      status={show.status}
                      label={
                        show.status === "published"
                          ? t.showsList.statusPublished
                          : t.showsList.statusDraft
                      }
                    />
                    {show.featured ? <Tag tone="accent" icon="star">{t.showsList.featured}</Tag> : null}
                    {show.justReleased ? <Tag>{t.showsList.justReleased}</Tag> : null}
                    {show.popularNow ? <Tag>{t.showsList.popular}</Tag> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-cream/45">
                    <span>/{show.slug}</span>
                    <span className="text-cream/25">·</span>
                    <span>{t.showsList.seasonCount(seasonN)}</span>
                    <span className="text-cream/25">·</span>
                    <span>{t.showsList.updatedDate(show.updatedAt.toISOString().slice(0, 10))}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="relative z-10 flex shrink-0 items-center gap-2">
                  <Link
                    href={`/admin/shows/${show.id}`}
                    className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                  >
                    {t.showsList.edit}
                  </Link>
                  <form action={softDeleteShow.bind(null, show.id)}>
                    <ConfirmDeleteButton
                      message={t.showsList.deleteConfirm(show.title)}
                    >
                      {t.showsList.delete}
                    </ConfirmDeleteButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusPill({
  status,
  label,
}: {
  status: "draft" | "published";
  label: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ${
        status === "published"
          ? "bg-[#7fd87a]/15 text-[#7fd87a]"
          : "bg-white/10 text-cream/65"
      }`}
    >
      {label}
    </span>
  );
}

function Tag({
  children,
  tone = "neutral",
  icon,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent";
  icon?: "star";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
        tone === "accent"
          ? "bg-gold/15 text-gold"
          : "bg-white/[0.07] text-cream/60"
      }`}
    >
      {icon === "star" ? <Icon name="star" size={9} color="#e6b366" /> : null}
      {children}
    </span>
  );
}
