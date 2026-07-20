import { Suspense } from "react";
import Link from "next/link";
import {
  loadRecentSessions,
  parseSessionsParams,
  sessionReplayUrl,
  SESSIONS_MAX_LIMIT,
  type SessionEvent,
  type SessionSummary,
} from "@/lib/posthog-sessions";
import { getAdminDict } from "@/lib/i18n/admin-server";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";
import { AnalyticsTabs } from "@/components/admin/analytics-tabs";

type SearchParams = Record<string, string | string[] | undefined>;
type SessionsDict = AdminDict["analyticsSessions"];

// Live feed — every render re-reads PostHog (60s-cached in the data layer).
export const dynamic = "force-dynamic";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { t } = await getAdminDict();
  const td = t.analyticsSessions;
  const sp = await searchParams;
  const { limit } = parseSessionsParams(sp);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {td.eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-cream">
            {td.heading}
          </h1>
          <p className="mt-1 text-sm text-cream/55">{td.subtitle}</p>
        </div>
        <p className="max-w-xs text-right text-[11px] leading-snug text-cream/40">
          {td.coverageNote}
        </p>
      </div>

      <AnalyticsTabs active="sessions" />

      <Suspense fallback={<ListSkeleton title={td.listTitle} />}>
        <SessionsSection td={td} limit={limit} />
      </Suspense>
    </div>
  );
}

// ---- Data section ----------------------------------------------------------

async function SessionsSection({
  td,
  limit,
}: {
  td: SessionsDict;
  limit: number;
}) {
  const res = await loadRecentSessions(limit);

  if (res.status === "not_configured") {
    return (
      <Shell title={td.notConfiguredTitle}>
        <p className="py-6 text-center text-sm text-cream/55">
          {td.notConfiguredBody}
        </p>
      </Shell>
    );
  }
  if (res.status === "error") {
    return (
      <Shell title={td.listTitle}>
        <p className="py-6 text-center text-sm text-cream/55">
          {td.loadError}
          <span className="mt-1 block text-[11px] text-cream/35">
            {res.message}
          </span>
        </p>
      </Shell>
    );
  }
  if (res.sessions.length === 0) {
    return (
      <Shell title={td.listTitle}>
        <p className="py-6 text-center text-sm text-cream/55">{td.empty}</p>
      </Shell>
    );
  }

  return (
    <Shell title={`${td.listTitle} (${res.sessions.length})`}>
      <div>
        {res.sessions.map((s) => (
          <SessionRow key={s.id} s={s} td={td} now={res.now} />
        ))}
      </div>
      {res.sessions.length >= limit && limit < SESSIONS_MAX_LIMIT ? (
        <div className="mt-4 text-center">
          <Link
            href={`/admin/analytics/sessions?n=${Math.min(limit * 2, SESSIONS_MAX_LIMIT)}`}
            className="text-xs font-bold text-gold hover:underline"
          >
            {td.showMore}
          </Link>
        </div>
      ) : null}
    </Shell>
  );
}

// ---- Session row -----------------------------------------------------------

function SessionRow({
  s,
  td,
  now,
}: {
  s: SessionSummary;
  td: SessionsDict;
  now: number;
}) {
  const source = sourceLabel(s, td);
  const identified = s.email != null;
  const replay = s.hasReplay ? sessionReplayUrl(s.id) : null;

  return (
    <details className="group border-b border-white/[0.06] last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3.5 [&::-webkit-details-marker]:hidden">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            identified ? "bg-gold" : "bg-cream/25"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="max-w-[16rem] truncate text-[13px] font-semibold text-cream">
              {s.email ?? td.anonymous}
            </span>
            {s.country ? (
              <span className="text-[10px] font-bold text-cream/60">
                {s.country}
              </span>
            ) : null}
            <span className={`text-[10px] font-semibold ${source.cls}`}>
              {source.text}
            </span>
            <span className="text-[10px] text-cream/35">
              · {timeAgo(now - new Date(s.endedAt).getTime(), td)}
            </span>
          </div>
          <div className="mt-1 flex gap-2.5 text-[11px] text-cream/50">
            <span className="shrink-0">{td.eventsCount(s.eventCount)}</span>
            <span className="shrink-0">{duration(s, td)}</span>
            {s.device ? <span className="shrink-0">{s.device}</span> : null}
            {s.paths.length > 0 ? (
              <span className="truncate">{s.paths.join(" → ")}</span>
            ) : null}
          </div>
        </div>
        <svg
          className="shrink-0 text-cream/35 transition-transform group-open:rotate-180"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </summary>

      <div className="pb-4 pl-1">
        {s.events.map((e, i) => (
          <TimelineItem
            key={i}
            e={e}
            last={i === s.events.length - 1}
            // A truncated timeline's last shown item is NOT the session's
            // latest event — only a complete timeline gets the gold dot.
            latest={i === s.events.length - 1 && s.hiddenEvents === 0}
            td={td}
          />
        ))}
        {s.hiddenEvents > 0 ? (
          <p className="ml-7 mt-1 text-[11px] text-cream/35">
            {td.moreEvents(s.hiddenEvents)}
          </p>
        ) : null}
        <div className="ml-7 mt-2 flex flex-wrap items-center gap-3">
          {s.exitPath ? (
            <span className="text-[11px] italic text-cream/35">
              {td.endedOn(s.exitPath)}
            </span>
          ) : null}
          {replay ? (
            <a
              href={replay}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-bold text-gold hover:underline"
            >
              {td.replay}
            </a>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function TimelineItem({
  e,
  last,
  latest,
  td,
}: {
  e: SessionEvent;
  /** Last rendered item — terminates the connecting line. */
  last: boolean;
  /** True session end — gets the gold dot. */
  latest: boolean;
  td: SessionsDict;
}) {
  const label =
    (td.eventLabels as Record<string, string>)[e.event] ??
    e.event.replace(/^\$/, "").replace(/_/g, " ");
  return (
    <div className="flex gap-3">
      <div className="flex w-4 shrink-0 flex-col items-center">
        <span
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
            latest ? "bg-gold" : "bg-white/20"
          }`}
        />
        {!last ? <span className="mt-1 w-px flex-1 bg-white/[0.08]" /> : null}
      </div>
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-cream">{label}</span>
          {e.showSlug ? (
            <span className="text-[11px] text-gold/90">/{e.showSlug}</span>
          ) : null}
          {e.episodeNumber != null ? (
            <span className="text-[10px] text-cream/50">
              {td.epShort(e.episodeNumber)}
            </span>
          ) : null}
          {e.mode ? (
            <span className="text-[10px] text-cream/40">{e.mode}</span>
          ) : null}
          {e.auth ? (
            <span className="text-[10px] text-cream/40">{e.auth}</span>
          ) : null}
          {e.path && !e.showSlug ? (
            <span className="max-w-[18rem] truncate text-[10px] text-cream/35">
              {e.path}
            </span>
          ) : null}
        </div>
        <span className="text-[10px] text-cream/30">
          {new Date(e.ts).toISOString().slice(11, 19)}
        </span>
      </div>
    </div>
  );
}

// ---- Formatting helpers ----------------------------------------------------

function sourceLabel(
  s: SessionSummary,
  td: SessionsDict,
): { text: string; cls: string } {
  if (s.utmSource) {
    const campaign = s.utmCampaign
      ? ` / ${
          s.utmCampaign.length > 12
            ? `${s.utmCampaign.slice(0, 10)}…`
            : s.utmCampaign
        }`
      : "";
    return { text: `${s.utmSource}${campaign}`, cls: "text-gold/90" };
  }
  if (s.referrer) {
    let host = s.referrer;
    try {
      host = new URL(s.referrer).hostname;
    } catch {
      // keep the raw value
    }
    return { text: host, cls: "text-cream/55" };
  }
  return { text: td.direct, cls: "text-cream/40" };
}

function duration(s: SessionSummary, td: SessionsDict): string {
  const sec = Math.max(
    0,
    Math.round(
      (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000,
    ),
  );
  if (sec < 60) return td.durationSec(sec);
  return td.durationMin(Math.round(sec / 60));
}

function timeAgo(ms: number, td: SessionsDict): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return td.timeAgoNow;
  if (min < 60) return td.timeAgoMin(min);
  const hr = Math.round(min / 60);
  if (hr < 24) return td.timeAgoHr(hr);
  return td.timeAgoDay(Math.round(hr / 24));
}

// ---- Shells ----------------------------------------------------------------

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ListSkeleton({ title }: { title: string }) {
  return (
    <Shell title={title}>
      <div className="h-64 animate-pulse rounded-lg bg-white/[0.03]" />
    </Shell>
  );
}
