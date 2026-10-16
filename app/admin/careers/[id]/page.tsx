import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobApplications } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { VACANCIES } from "@/lib/careers";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/job-application";
import { CandidateLink } from "@/components/admin/candidate-link";
import { JobApplicationDeleteForm } from "@/components/admin/job-application-delete-form";
import { AdminPageHeader, DangerPanel, Panel } from "@/components/admin/ui";
import { deleteJobApplication } from "../actions";

// A malformed id never reaches Postgres: `uuid = 'garbage'` is a 22P02 there,
// which would render as a 500 instead of a 404.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatReceived(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// One application, read-only (#376). Everything the candidate typed is a
// React text child — no dangerouslySetInnerHTML, no auto-linking of the
// message, and the address is plain text, not a mailto: link.
export default async function JobApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t } = await getAdminDict();
  const td = t.careerDetail;

  const [app] = await db
    .select()
    .from(jobApplications)
    .where(eq(jobApplications.id, id))
    .limit(1);
  if (!app) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <AdminPageHeader
        backHref="/admin/careers"
        backLabel={td.back}
        kicker={VACANCIES[app.position].title}
        title={app.fullName}
        subtitle={td.received(formatReceived(app.createdAt))}
      />

      <Panel kicker={td.candidateKicker} title={td.candidateTitle}>
        <dl className="space-y-4">
          <Row label={td.positionLabel}>{VACANCIES[app.position].title}</Row>
          <Row label={td.nameLabel}>{app.fullName}</Row>
          <Row label={td.emailLabel}>
            <span className="break-all font-mono text-xs">{app.email}</span>
          </Row>
          <Row label={td.locationLabel}>{app.location}</Row>
          <Row label={td.idLabel}>
            <span className="font-mono text-xs">{app.id}</span>
          </Row>
        </dl>
      </Panel>

      <Panel kicker={td.workKicker} title={td.workTitle} hint={td.workHint}>
        <dl className="space-y-4">
          <Row label={td.linkedinLabel}>
            {app.linkedinUrl ? <CandidateLink value={app.linkedinUrl} /> : td.none}
          </Row>
          <Row label={td.portfolioLabel}>
            {app.portfolioUrl ? <CandidateLink value={app.portfolioUrl} /> : td.none}
          </Row>
          <Row label={td.socialsLabel}>
            {app.socialLinks.length > 0 ? (
              <ul className="space-y-1.5">
                {app.socialLinks.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cream/55">
                      {SOCIAL_PLATFORM_LABELS[s.platform] ?? s.platform}
                    </span>
                    <CandidateLink value={s.value} />
                  </li>
                ))}
              </ul>
            ) : (
              td.none
            )}
          </Row>
        </dl>
      </Panel>

      <Panel kicker={td.messageKicker} title={td.messageTitle} hint={td.messageHint}>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-cream/85">
          {app.message}
        </p>
      </Panel>

      <DangerPanel description={td.deleteDescription}>
        {/* "detail": this page's own row is gone after the delete, so the
            action leaves for the list instead of re-rendering into
            notFound. */}
        <JobApplicationDeleteForm
          action={deleteJobApplication.bind(null, app.id, "detail")}
          label={td.deleteThis}
          confirm={td.deleteConfirm}
          failed={td.deleteFailed}
        />
      </DangerPanel>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cream/45">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-cream/85">{children}</dd>
    </div>
  );
}
