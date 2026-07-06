import { isNull } from "drizzle-orm";
import { db } from "@/db";
import { shows } from "@/db/schema";
import { loadTrackedLinks } from "@/lib/admin-analytics";
import { SITE_URL } from "@/lib/seo";
import { buildTrackedUrl } from "@/lib/tracked-links";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { LinkForm } from "@/components/admin/link-form";
import { CopyButton } from "@/components/admin/copy-button";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { archiveMarketingLink } from "./actions";

// Always reflect the live links table + session stats.
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function LinksPage() {
  const { t } = await getAdminDict();
  const tl = t.links;
  const now = new Date();
  const [links, showsList] = await Promise.all([
    // Fixed 30-day stats window — the dashboard's tracked-links panel is the
    // filterable view; this page is for creating and copying links.
    loadTrackedLinks({ from: new Date(now.getTime() - 30 * DAY_MS), to: now }),
    db
      .select({ slug: shows.slug, title: shows.title })
      .from(shows)
      .where(isNull(shows.deletedAt))
      .orderBy(shows.title),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
          {tl.eyebrow}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-cream">
          {tl.heading}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-cream/55">{tl.sub}</p>
      </div>

      <LinkForm shows={showsList} origin={SITE_URL} />

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
        <div className="mb-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {tl.tableKicker}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-base font-bold tracking-tight text-cream">
              {tl.tableTitle}
            </h2>
            <span className="text-[11px] text-cream/45">{tl.tableHint}</span>
          </div>
        </div>

        {links.length === 0 ? (
          <p className="py-8 text-center text-sm text-cream/55">{tl.empty}</p>
        ) : (
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-cream/45">
                  <th className="px-5 py-2 text-left font-semibold sm:px-6">
                    {tl.colName}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">
                    {tl.colTarget}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {tl.colSessions30}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {tl.colPlayed}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {tl.colSignups}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold">
                    {tl.colAllTime}
                  </th>
                  <th className="px-5 py-2 text-right font-semibold sm:px-6" />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id} className="border-t border-white/[0.05] align-top">
                    <td className="px-5 py-3 sm:px-6">
                      <p className="text-sm font-semibold text-cream">{l.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-cream/40">
                        {l.source} · {l.medium} · {l.campaign}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-cream/60">
                      {l.targetPath}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-cream/75">
                      {l.sessions.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-cream/55">
                      {l.played.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-cream/75">
                      {l.signups.toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-cream/55">
                      {l.allTimeSessions.toLocaleString()}
                    </td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      <div className="flex items-center justify-end gap-2">
                        <CopyButton
                          value={buildTrackedUrl(SITE_URL, l.targetPath, {
                            source: l.source,
                            medium: l.medium,
                            campaign: l.campaign,
                          })}
                          name={l.name}
                        />
                        <form action={archiveMarketingLink.bind(null, l.id)}>
                          <ConfirmDeleteButton message={tl.archiveConfirm(l.name)}>
                            {tl.archive}
                          </ConfirmDeleteButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-cream/35">
          {tl.consentNote}
        </p>
      </section>
    </div>
  );
}
