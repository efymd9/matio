import Link from "next/link";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobApplications } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { VACANCIES, VACANCY_LIST, isJobPosition } from "@/lib/careers";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { cn } from "@/lib/utils";
import { JobApplicationDeleteForm } from "@/components/admin/job-application-delete-form";
import { deleteJobApplication } from "./actions";

// Always the live table — an application (or a deletion) shows up on reload.
export const dynamic = "force-dynamic";

// Newest first, capped. No pagination in v1 (docs/registry.md, #376); the
// header says how many rows the cap hides.
const LIST_LIMIT = 500;

// UTC on purpose: the admin reads it next to Neon and the runbook's request
// log, which are UTC too.
function formatReceived(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// /admin/careers — the job applications from /careers (#376), filtered by
// role through `?position=` (a vacancy id; anything else = all). The filter
// is the only query parameter: never an address in a URL — it would land in
// the request logs.
export default async function CareersApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string | string[] }>;
}) {
  await requireAdmin();
  const { t } = await getAdminDict();
  const tl = t.careersList;
  const tdt = t.careerDetail;
  const { position: rawPosition } = await searchParams;
  const position = isJobPosition(rawPosition) ? rawPosition : null;
  const where = position ? eq(jobApplications.position, position) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    // `message` (up to 2,000 characters) and the links are deliberately NOT
    // selected: the list never shows them — the detail page reads one row.
    db
      .select({
        id: jobApplications.id,
        createdAt: jobApplications.createdAt,
        fullName: jobApplications.fullName,
        position: jobApplications.position,
        location: jobApplications.location,
        email: jobApplications.email,
      })
      .from(jobApplications)
      .where(where)
      .orderBy(desc(jobApplications.createdAt))
      .limit(LIST_LIMIT),
    db.select({ total: count() }).from(jobApplications).where(where),
  ]);

  const filters: { href: string; label: string; active: boolean }[] = [
    { href: "/admin/careers", label: tl.filterAll, active: position === null },
    ...VACANCY_LIST.map((v) => ({
      href: `/admin/careers?position=${v.id}`,
      label: v.shortTitle,
      active: position === v.id,
    })),
  ];

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

      <nav aria-label={tl.filterAria} className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            aria-current={f.active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors",
              f.active
                ? "border-gold/60 bg-gold/15 text-gold"
                : "border-white/15 text-cream/70 hover:bg-white/[0.06] hover:text-cream",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] py-20 text-center">
          <p className="text-sm text-cream/55">
            {position ? tl.emptyFiltered : tl.empty}
          </p>
        </div>
      ) : (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 sm:p-6">
          <div className="-mx-5 overflow-x-auto sm:-mx-6">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.08em] text-cream/45">
                  <th className="px-5 py-2 text-left font-semibold sm:px-6">
                    {tl.colReceived}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold">{tl.colName}</th>
                  <th className="px-3 py-2 text-left font-semibold">{tl.colPosition}</th>
                  <th className="px-3 py-2 text-left font-semibold">{tl.colLocation}</th>
                  <th className="px-3 py-2 text-left font-semibold">{tl.colEmail}</th>
                  <th className="px-5 py-2 text-right font-semibold sm:px-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-white/[0.05] align-top">
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-[11px] text-cream/60 sm:px-6">
                      {formatReceived(r.createdAt)}
                    </td>
                    <td className="max-w-[200px] break-words px-3 py-3 text-xs font-semibold text-cream/85">
                      {r.fullName}
                    </td>
                    <td className="px-3 py-3 text-xs text-gold">
                      {VACANCIES[r.position].shortTitle}
                    </td>
                    <td className="max-w-[180px] break-words px-3 py-3 text-xs text-cream/75">
                      {r.location}
                    </td>
                    <td className="max-w-[220px] break-all px-3 py-3 font-mono text-[11px] text-cream/65">
                      {r.email}
                    </td>
                    <td className="px-5 py-3 text-right sm:px-6">
                      <div className="flex items-start justify-end gap-2">
                        <Link
                          href={`/admin/careers/${r.id}`}
                          className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs font-semibold text-cream/80 transition-colors hover:bg-white/[0.06] hover:text-cream"
                        >
                          {tl.open}
                        </Link>
                        {/* "list": stay here — revalidatePath drops the row. */}
                        <JobApplicationDeleteForm
                          action={deleteJobApplication.bind(null, r.id, "list")}
                          label={tdt.delete}
                          confirm={tdt.deleteConfirm}
                          failed={tdt.deleteFailed}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-[11px] leading-relaxed text-cream/40">{tl.retentionNote}</p>
    </div>
  );
}
