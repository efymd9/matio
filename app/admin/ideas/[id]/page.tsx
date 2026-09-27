import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ideaSubmissions, shows } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { getAdminDict } from "@/lib/i18n/admin-server";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { AdminPageHeader, DangerPanel, Panel } from "@/components/admin/ui";
import { deleteIdeaSubmission } from "../actions";

// A malformed id never reaches Postgres: `uuid = 'garbage'` is a 22P02 there,
// which would render as a 500 instead of a 404.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatReceived(d: Date): string {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function touch(
  source: string | null,
  medium: string | null,
  campaign: string | null,
): string {
  if (!source && !medium && !campaign) return "—";
  return `${source ?? "—"} · ${medium ?? "—"} · ${campaign ?? "—"}`;
}

// One idea, read-only (#297). Everything a fan typed is rendered as a React
// text child — no dangerouslySetInnerHTML, no auto-linking (a URL in a story
// stays inert text), and the address is plain text, not a mailto: link.
export default async function IdeaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t } = await getAdminDict();
  const tl = t.ideasList;
  const td = t.ideaDetail;

  const [idea] = await db
    .select({
      id: ideaSubmissions.id,
      createdAt: ideaSubmissions.createdAt,
      kind: ideaSubmissions.kind,
      showTitle: shows.title,
      workingTitle: ideaSubmissions.workingTitle,
      logline: ideaSubmissions.logline,
      story: ideaSubmissions.story,
      authorName: ideaSubmissions.authorName,
      email: ideaSubmissions.email,
      locale: ideaSubmissions.locale,
      marketingOptIn: ideaSubmissions.marketingOptIn,
      termsVersion: ideaSubmissions.termsVersion,
      firstSource: ideaSubmissions.attributionFirstSource,
      firstMedium: ideaSubmissions.attributionFirstMedium,
      firstCampaign: ideaSubmissions.attributionFirstCampaign,
      lastSource: ideaSubmissions.attributionLastSource,
      lastMedium: ideaSubmissions.attributionLastMedium,
      lastCampaign: ideaSubmissions.attributionLastCampaign,
    })
    .from(ideaSubmissions)
    .leftJoin(shows, eq(ideaSubmissions.showId, shows.id))
    .where(eq(ideaSubmissions.id, id))
    .limit(1);
  if (!idea) notFound();

  const series =
    idea.kind === "new_series" ? tl.newSeries : (idea.showTitle ?? tl.showGone);

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <AdminPageHeader
        backHref="/admin/ideas"
        backLabel={td.back}
        kicker={
          idea.kind === "new_series"
            ? td.kickerNewSeries
            : td.kickerContinuation
        }
        title={idea.workingTitle ?? td.untitled}
        subtitle={td.received(formatReceived(idea.createdAt))}
      />

      <Panel kicker={td.pitchKicker} title={td.pitchTitle}>
        <dl className="space-y-4">
          <Row label={td.seriesLabel}>{series}</Row>
          <Row label={td.workingTitleLabel}>{idea.workingTitle ?? "—"}</Row>
          <Row label={td.loglineLabel}>
            <p className="whitespace-pre-wrap break-words">{idea.logline}</p>
          </Row>
        </dl>
      </Panel>

      <Panel kicker={td.storyKicker} title={td.storyTitle} hint={td.storyHint}>
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-cream/85">
          {idea.story}
        </p>
      </Panel>

      <Panel kicker={td.authorKicker} title={td.authorTitle}>
        <dl className="space-y-4">
          <Row label={td.nameLabel}>{idea.authorName}</Row>
          <Row label={td.emailLabel}>
            <span className="break-all font-mono text-xs">{idea.email}</span>
          </Row>
          <Row label={td.localeLabel}>
            <span className="font-mono text-xs uppercase">{idea.locale}</span>
          </Row>
          <Row label={td.marketingLabel}>
            {idea.marketingOptIn ? tl.yes : tl.no}
          </Row>
          <Row label={td.termsLabel}>
            <span className="font-mono text-xs">{idea.termsVersion}</span>
          </Row>
          <Row label={td.idLabel}>
            <span className="font-mono text-xs">{idea.id}</span>
          </Row>
        </dl>
      </Panel>

      <Panel
        kicker={td.attributionKicker}
        title={td.attributionTitle}
        hint={td.attributionHint}
      >
        <dl className="space-y-4">
          <Row label={td.firstTouch}>
            <span className="font-mono text-xs">
              {touch(idea.firstSource, idea.firstMedium, idea.firstCampaign)}
            </span>
          </Row>
          <Row label={td.lastTouch}>
            <span className="font-mono text-xs">
              {touch(idea.lastSource, idea.lastMedium, idea.lastCampaign)}
            </span>
          </Row>
        </dl>
      </Panel>

      <DangerPanel description={td.deleteDescription}>
        {/* "detail": this page's own row is gone after the delete, so the
            action leaves for the list instead of re-rendering into
            notFound. */}
        <form action={deleteIdeaSubmission.bind(null, idea.id, "detail")}>
          <ConfirmDeleteButton message={td.deleteConfirm}>
            {td.deleteThisIdea}
          </ConfirmDeleteButton>
        </form>
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
