import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ideaSubmissions, shows } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { deleteIdeaSubmission } from "./actions";

// Always the live table — a fan's idea (or a deletion) shows up on reload.
export const dynamic = "force-dynamic";

// Newest first, capped. No pagination in v1 (docs/registry.md, #297); the
// header says how many rows the cap hides.
const LIST_LIMIT = 500;

// UTC on purpose: the admin reads it next to Neon and the runbook's request
// log, which are UTC too.
function formatReceived(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function IdeasPage() {
  await requireAdmin();
  const { t } = await getAdminDict();
  const tl = t.ideasList;

  const [rows, [{ total }]] = await Promise.all([
    // `story` is deliberately NOT selected: up to 10,000 characters a row ×
    // 500 rows is a heavy page for a column the list never shows. The detail
    // page reads it for one row.
    db
      .select({
        id: ideaSubmissions.id,
        createdAt: ideaSubmissions.createdAt,
        kind: ideaSubmissions.kind,
        showTitle: shows.title,
        workingTitle: ideaSubmissions.workingTitle,
        logline: ideaSubmissions.logline,
        authorName: ideaSubmissions.authorName,
        email: ideaSubmissions.email,
        locale: ideaSubmissions.locale,
        marketingOptIn: ideaSubmissions.marketingOptIn,
        firstSource: ideaSubmissions.attributionFirstSource,
        firstCampaign: ideaSubmissions.attributionFirstCampaign,
      })
      .from(ideaSubmissions)
      .leftJoin(shows, eq(ideaSubmissions.showId, shows.id))
      .orderBy(desc(ideaSubmissions.createdAt))
      .limit(LIST_LIMIT),
    db.select({ total: count() }).from(ideaSubmissions),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {tl.eyebrow}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-cream">
          {tl.title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-cream/55">{tl.sub}</p>
        <p className="mt-1 text-sm text-cream/55">
          {tl.countLine(rows.length, Number(total))}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          <p className="text-sm text-cream/55">{tl.empty}</p>
        </div>
      ) : (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[1180px] border-collapse text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-cream/45">
                  <th className="px-5 py-2 text-left font-semibold sm:px-6">
                    {tl.colReceived}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colSeries}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colWorkingTitle}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colLogline}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colName}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colEmail}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colLocale}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colMarketing}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colSource}
                  </th>
                  <th className="px-5 py-2 text-right font-semibold sm:px-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.05] align-top">
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-[11px] text-cream/60 sm:px-6">
                      {formatReceived(r.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-xs text-cream/75">
                      {r.kind === "new_series" ? (
                        <span className="font-semibold text-gold">
                          {tl.newSeries}
                        </span>
                      ) : (
                        <>
                          <span className="block text-cream/45">
                            {tl.continuation}
                          </span>
                          <span className="font-semibold text-cream">
                            {r.showTitle ?? tl.showGone}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="max-w-[160px] px-3 py-3 text-xs text-cream/75">
                      {r.workingTitle ?? "—"}
                    </td>
                    <td className="max-w-[280px] px-3 py-3 text-xs leading-relaxed text-cream/75">
                      <p className="line-clamp-2 break-words">{r.logline}</p>
                    </td>
                    <td className="max-w-[140px] break-words px-3 py-3 text-xs text-cream/85">
                      {r.authorName}
                    </td>
                    <td className="max-w-[200px] break-all px-3 py-3 font-mono text-[11px] text-cream/65">
                      {r.email}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] uppercase text-cream/60">
                      {r.locale}
                    </td>
                    <td className="px-3 py-3 text-xs text-cream/65">
                      {r.marketingOptIn ? tl.yes : tl.no}
                    </td>
                    <td className="max-w-[180px] break-words px-3 py-3 font-mono text-[11px] text-cream/55">
                      {r.firstSource || r.firstCampaign
                        ? `${r.firstSource ?? "—"} · ${r.firstCampaign ?? "—"}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/ideas/${r.id}`}
                          className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                        >
                          {tl.open}
                        </Link>
                        {/* "list": stay here — revalidatePath drops the row. */}
                        <form action={deleteIdeaSubmission.bind(null, r.id, "list")}>
                          <ConfirmDeleteButton message={tl.deleteConfirm}>
                            {tl.delete}
                          </ConfirmDeleteButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-[11px] leading-relaxed text-cream/40">
        {tl.retentionNote}
      </p>
    </div>
  );
}
