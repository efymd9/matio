import {
  campaignLabel,
  loadDashboard,
  parseFilters,
} from "@/lib/admin-analytics";
import { AnalyticsFilters } from "@/components/admin/analytics-filters";
import { TimeSeriesChart } from "@/components/admin/time-series-chart";
import {
  BarList,
  Donut,
  FunnelChart,
  Histogram,
  KpiTile,
} from "@/components/admin/charts";

// Reading searchParams forces dynamic rendering — the dashboard always reflects
// the live DB + current filter URL.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const RANGE_LABEL: Record<string, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  all: "all time",
  custom: "custom range",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp, new Date());
  const d = await loadDashboard(filters);
  const k = d.kpis;

  const rangeLabel = RANGE_LABEL[filters.preset] ?? "selected range";
  const showLabel =
    filters.show === "all"
      ? null
      : (d.showsList.find((s) => s.slug === filters.show)?.title ?? filters.show);
  const channelLabel = filters.channel === "all" ? null : filters.channel;

  // Sparklines from the time series (period-scoped flow metrics).
  const sparkTrials = d.series.map((p) => p.trials);
  const sparkSignups = d.series.map((p) => p.signups);
  const sparkConversions = d.series.map((p) => p.conversions);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
            Analytics
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {rangeLabel}
            {showLabel ? ` · ${showLabel}` : ""}
            {channelLabel ? ` · ${channelLabel}` : ""}
            {` · ${filters.attribution}-touch`}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <AnalyticsFilters
        filters={filters}
        shows={d.showsList.map((s) => ({ slug: s.slug, title: s.title }))}
        channels={d.channelOptions}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Signups"
          value={k.signups.value.toLocaleString()}
          current={k.signups.value}
          prev={k.signups.prev}
          spark={sparkSignups}
          sub={rangeLabel}
        />
        <KpiTile
          label="Trial previews"
          value={k.trialPreviews.value.toLocaleString()}
          current={k.trialPreviews.value}
          prev={k.trialPreviews.prev}
          spark={sparkTrials}
          sub={rangeLabel}
        />
        <KpiTile
          label="Conversions"
          value={k.conversions.value.toLocaleString()}
          current={k.conversions.value}
          prev={k.conversions.prev}
          spark={sparkConversions}
          sub="trials → paid"
        />
        <KpiTile
          label="Trial → paid"
          value={`${k.conversionRate.toFixed(1)}%`}
          sub={`${k.conversionConverted}/${k.conversionStarted} sessions`}
        />
        <KpiTile
          label="MRR"
          value={`$${k.mrr.toLocaleString()}`}
          sub={`${k.activeSubs} active${k.servicedSubs !== k.activeSubs ? ` · ${k.servicedSubs} serviced` : ""}`}
        />
        <KpiTile
          label="New subs"
          value={k.newSubs.value.toLocaleString()}
          current={k.newSubs.value}
          prev={k.newSubs.prev}
          sub={rangeLabel}
        />
      </div>

      {/* Funnel + status mix */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Section
          title="Acquisition funnel"
          hint="trial preview → engaged → near paywall → converted"
        >
          <FunnelChart
            steps={[
              {
                label: "Trial previews started",
                value: d.funnel.previews,
                hint: "Distinct (session, show) trial rows in range",
              },
              {
                label: "Played (>0s)",
                value: d.funnel.played,
                hint: "Trials that recorded any playhead",
              },
              {
                label: "Reached paywall (~55s+)",
                value: d.funnel.nearCap,
                hint: "Got near the 60s preview cap",
              },
              {
                label: "Converted to paid",
                value: d.funnel.converted,
                hint: "Trial sessions now marked converted",
              },
            ]}
          />
          <p className="mt-4 text-[10px] leading-relaxed text-white/35">
            Trial depth is the last-saved resume playhead per session, not
            cumulative watch time — &ldquo;played&rdquo; undercounts very short
            previews that never ticked a save. Avg depth {d.funnel.avgDepth}s of
            the 60s cap.
          </p>
        </Section>

        <Section title="Subscriptions" hint={`mix · ${filterScopeLabel(filters.status)}`}>
          <Donut
            segments={d.statusMix.map((s) => ({ label: s.status, value: s.n }))}
          />
        </Section>
      </div>

      {/* Time series */}
      <Section
        title="Trend"
        hint={`${rangeLabel} · ${filters.granularity}`}
      >
        <TimeSeriesChart series={d.series} granularity={filters.granularity} />
      </Section>

      {/* Campaign table */}
      <Section
        title={`Channels & campaigns · ${filters.attribution}-touch`}
        hint={
          filters.attribution === "first"
            ? "which channel opened the relationship"
            : "what ad platforms attribute the conversion to"
        }
      >
        <CampaignTable rows={d.campaign} />
      </Section>

      {/* Trial preview depth */}
      <Section
        title="Trial preview depth"
        hint="how far into the 60s preview viewers get"
      >
        <Histogram bars={d.depthHistogram} />
      </Section>

      {/* Engagement + Top shows */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Subscriber engagement"
          hint="watch_progress · subscriber-only"
        >
          <div className="grid grid-cols-2 gap-3">
            <KpiTile
              label="Completion rate"
              value={`${d.engagement.completionRate.toFixed(0)}%`}
              sub={`${d.engagement.completedRows}/${d.engagement.watchRows} finished`}
              approx
            />
            <KpiTile
              label="Avg % watched"
              value={`${d.engagement.avgPctWatched.toFixed(0)}%`}
              sub={`n=${d.engagement.watchRows}`}
              approx
            />
            <KpiTile
              label="Avg / viewer"
              value={`${d.engagement.avgMinPerViewer} min`}
              sub={`${d.engagement.distinctViewers} viewer${d.engagement.distinctViewers === 1 ? "" : "s"}`}
              approx
            />
            <KpiTile
              label="Watch rows"
              value={d.engagement.watchRows.toLocaleString()}
              sub="subscriber resume points"
            />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-white/35">
            Approximate — resume playhead per (subscriber, episode), not
            cumulative minutes. Real watch-time is in the Mux panel below.
          </p>
        </Section>

        <Section
          title="Top shows"
          hint="subscriber watch time (resume-position proxy)"
        >
          <BarList
            items={d.topShows.map((s) => ({
              label: s.title,
              href: `/shows/${s.slug}`,
              value: s.seconds,
              sub: `${s.viewers} viewer${s.viewers === 1 ? "" : "s"} · ${
                s.plays > 0 ? Math.round((s.completed / s.plays) * 100) : 0
              }%`,
            }))}
            format={(sec) => `${Math.round(sec / 60).toLocaleString()} min`}
            emptyLabel="No subscriber watch progress recorded yet."
          />
        </Section>
      </div>

      {/* Mux real watch time */}
      <Section
        title="Watch time · Mux Data"
        hint={`real playback · ${muxWindowLabel(d.muxTimeframe)} · hero excluded`}
      >
        {d.muxClamped ? (
          <p className="mb-3 rounded-lg border border-[#f5c451]/25 bg-[#f5c451]/[0.06] px-3 py-2 text-[11px] text-[#f5c451]">
            Mux Data caps at a 30-day window — showing the last 30 days even
            though the dashboard range is wider.
          </p>
        ) : null}
        {d.mux.status === "not_configured" ? (
          <p className="py-6 text-center text-sm leading-relaxed text-white/55">
            Not connected. Add a Mux access token with{" "}
            <span className="font-mono text-white/70">Mux Data: Read</span> as{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
              MUX_DATA_API_TOKEN_ID
            </code>{" "}
            /{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
              MUX_DATA_API_TOKEN_SECRET
            </code>
            .
          </p>
        ) : d.mux.status === "no_data" ? (
          <p className="py-6 text-center text-sm text-white/55">
            Connected — no views recorded in this window yet. Mux Data appears a
            few minutes after consenting viewers watch.
          </p>
        ) : d.mux.status === "error" ? (
          <p className="py-6 text-center text-sm text-white/55">
            {d.mux.message}
          </p>
        ) : (
          <MuxPanel summary={d.mux.summary} byShow={d.mux.byShow} />
        )}
      </Section>
    </div>
  );
}

function MuxPanel({
  summary,
  byShow,
}: {
  summary: { watchTimeMs: number; views: number; uniqueViewers: number };
  byShow: { show: string; views: number; watchTimeMs: number }[];
}) {
  const hours = summary.watchTimeMs / 3_600_000;
  const avgViewMin =
    summary.views > 0 ? summary.watchTimeMs / summary.views / 60_000 : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label="Total watch time"
          value={`${hours.toFixed(1)} h`}
          sub={`${Math.round(summary.watchTimeMs / 60_000).toLocaleString()} min`}
        />
        <KpiTile label="Views" value={summary.views.toLocaleString()} />
        <KpiTile
          label="Unique viewers"
          value={summary.uniqueViewers.toLocaleString()}
        />
        <KpiTile
          label="Avg view"
          value={`${avgViewMin.toFixed(1)} min`}
          sub="per view"
        />
      </div>
      {byShow.length > 0 ? (
        <BarList
          items={byShow.slice(0, 10).map((s) => ({
            label: s.show,
            value: s.watchTimeMs,
            sub: `${s.views.toLocaleString()} view${s.views === 1 ? "" : "s"}`,
          }))}
          format={(ms) => `${Math.round(ms / 60_000).toLocaleString()} min`}
        />
      ) : null}
    </div>
  );
}

function CampaignTable({
  rows,
}: {
  rows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    trials: number;
    signups: number;
    activeSubs: number;
    mrr: number;
  }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-white/55">
        No campaign data in this range. Tag landing URLs with utm_source /
        utm_medium / utm_campaign to attribute.
      </p>
    );
  }
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-white/45">
            <th className="px-5 py-2 text-left font-semibold">Campaign</th>
            <th className="px-3 py-2 text-left font-semibold">Source / medium</th>
            <th className="px-3 py-2 text-right font-semibold">Trials</th>
            <th className="px-3 py-2 text-right font-semibold">Signups</th>
            <th className="px-3 py-2 text-right font-semibold">Subs</th>
            <th className="px-3 py-2 text-right font-semibold">Trial→sub</th>
            <th className="px-5 py-2 text-right font-semibold">MRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const label = campaignLabel(r.source, r.medium, r.campaign);
            const t2s =
              r.trials > 0 ? ((r.activeSubs / r.trials) * 100).toFixed(1) : "—";
            return (
              <tr
                key={`${label.source}|${label.medium}|${label.campaign}`}
                className="border-t border-white/[0.05]"
              >
                <td className="px-5 py-3 align-top">
                  <span
                    className={
                      label.isDirect
                        ? "font-mono text-xs text-white/45"
                        : "text-sm font-semibold text-white"
                    }
                  >
                    {label.campaign}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-xs text-white/55">
                  {label.source}
                  <span className="text-white/30"> · </span>
                  {label.medium}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/75">
                  {r.trials.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/75">
                  {r.signups.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/75">
                  {r.activeSubs.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/55">
                  {t2s === "—" ? "—" : `${t2s}%`}
                </td>
                <td className="px-5 py-3 text-right align-top font-mono text-xs font-semibold text-white">
                  ${r.mrr.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {hint ? (
          <span className="text-right text-[11px] text-white/45">{hint}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function filterScopeLabel(status: string): string {
  if (status === "active") return "active only";
  if (status === "all") return "all statuses";
  return "all statuses shown";
}

function muxWindowLabel(tf: string): string {
  if (tf === "24:hours") return "last 24 hours";
  if (tf === "7:days") return "last 7 days";
  return "last 30 days";
}
