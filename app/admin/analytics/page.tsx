import { Suspense } from "react";
import {
  campaignLabel,
  loadDashboard,
  loadEpisodeFunnels,
  parseFilters,
  type AnalyticsFilters as Filters,
} from "@/lib/admin-analytics";
import { getMuxData, muxTimeframeForDays } from "@/lib/mux-data";
import { AnalyticsFilters } from "@/components/admin/analytics-filters";
import { TimeSeriesChart } from "@/components/admin/time-series-chart";
import {
  BarList,
  Donut,
  FunnelChart,
  Histogram,
  KpiTile,
} from "@/components/admin/charts";
import { getAdminDict } from "@/lib/i18n/admin-server";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";

// Reading searchParams forces dynamic rendering — the dashboard always reflects
// the live DB + current filter URL.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

// Range preset → analytics dict key. Keys stay at module scope; the labels are
// resolved at render time from the admin dictionary.
const RANGE_LABEL_KEY: Record<
  string,
  keyof Pick<
    AdminDict["analytics"],
    | "rangeLast24Hours"
    | "rangeLast7Days"
    | "rangeLast30Days"
    | "rangeLast90Days"
    | "rangeAllTime"
    | "rangeCustom"
  >
> = {
  "24h": "rangeLast24Hours",
  "7d": "rangeLast7Days",
  "30d": "rangeLast30Days",
  "90d": "rangeLast90Days",
  all: "rangeAllTime",
  custom: "rangeCustom",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { t } = await getAdminDict();
  const ta = t.analytics;
  const sp = await searchParams;
  const filters = parseFilters(sp, new Date());
  const [d, episodeFunnels] = await Promise.all([
    loadDashboard(filters),
    loadEpisodeFunnels(filters),
  ]);
  const k = d.kpis;

  const rangeKey = RANGE_LABEL_KEY[filters.preset];
  const rangeLabel = rangeKey ? ta[rangeKey] : ta.rangeSelected;
  const touchLabel =
    filters.attribution === "first" ? ta.touchFirst : ta.touchLast;
  const showLabel =
    filters.show === "all"
      ? null
      : (d.showsList.find((s) => s.slug === filters.show)?.title ?? filters.show);
  const channelLabel = filters.channel === "all" ? null : filters.channel;
  const campaignLabel =
    filters.campaign === "all" ? null : filters.campaign;

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
            {ta.eyebrow}
          </p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
            {ta.heading}
          </h1>
          <p className="mt-1 text-sm text-white/55">
            {rangeLabel}
            {/* Resolved absolute window so a bookmarked relative-range URL
                shows its actual dates; skipped for all-time (the 2020 floor
                is an implementation detail, not a data boundary). */}
            {filters.preset !== "all"
              ? ` (${filters.from.toISOString().slice(0, 10)} → ${filters.to.toISOString().slice(0, 10)})`
              : ""}
            {showLabel ? ` · ${showLabel}` : ""}
            {channelLabel ? ` · ${channelLabel}` : ""}
            {campaignLabel ? ` · ${campaignLabel}` : ""}
            {` · ${touchLabel}`}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <AnalyticsFilters
        filters={filters}
        shows={d.showsList.map((s) => ({ slug: s.slug, title: s.title }))}
        channels={d.channelOptions}
        campaigns={d.campaignOptions}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label={ta.kpiSignups}
          value={k.signups.value.toLocaleString()}
          current={k.signups.value}
          prev={k.signups.prev}
          spark={sparkSignups}
          sub={ta.kpiSignupsSub(rangeLabel)}
        />
        <KpiTile
          label={ta.kpiTrialPreviews}
          value={k.trialPreviews.value.toLocaleString()}
          current={k.trialPreviews.value}
          prev={k.trialPreviews.prev}
          spark={sparkTrials}
          sub={rangeLabel}
        />
        <KpiTile
          label={ta.kpiConversions}
          value={k.conversions.value.toLocaleString()}
          current={k.conversions.value}
          prev={k.conversions.prev}
          spark={sparkConversions}
          sub={ta.kpiConversionsSub}
        />
        <KpiTile
          label={ta.kpiTrialToPaid}
          value={`${k.conversionRate.toFixed(1)}%`}
          sub={ta.kpiSessionsSub(k.conversionConverted, k.conversionStarted)}
        />
        <KpiTile
          label={ta.kpiMrr}
          value={`$${k.mrr.toLocaleString()}`}
          sub={`${ta.kpiActiveSub(k.activeSubs)}${k.servicedSubs !== k.activeSubs ? ` · ${ta.kpiServicedSub(k.servicedSubs)}` : ""}`}
        />
        <KpiTile
          label={ta.kpiNewSubs}
          value={k.newSubs.value.toLocaleString()}
          current={k.newSubs.value}
          prev={k.newSubs.prev}
          sub={rangeLabel}
        />
      </div>

      {/* Funnel + status mix */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Section
          title={ta.sectionAcquisitionFunnel}
          hint={ta.sectionAcquisitionFunnelHint}
        >
          <FunnelChart
            steps={[
              {
                label: ta.funnelPreviewsStarted,
                value: d.funnel.previews,
                hint: ta.funnelPreviewsStartedHint,
              },
              {
                label: ta.funnelPlayed,
                value: d.funnel.played,
                hint: ta.funnelPlayedHint,
              },
              {
                label: ta.funnelReachedPaywall,
                value: d.funnel.nearCap,
                hint: ta.funnelReachedPaywallHint,
              },
              {
                label: ta.funnelConverted,
                value: d.funnel.converted,
                hint: ta.funnelConvertedHint,
              },
            ]}
          />
          <p className="mt-4 text-[10px] leading-relaxed text-white/35">
            {ta.funnelDepthNote(d.funnel.avgDepth)}
          </p>
        </Section>

        <Section
          title={ta.sectionSubscriptions}
          hint={ta.sectionSubscriptionsHintMix(filterScopeLabel(filters.status, ta))}
        >
          <Donut
            segments={d.statusMix.map((s) => ({ label: s.status, value: s.n }))}
          />
          <div className="mt-4">
            <KpiTile
              label={ta.kpiCancellations}
              value={k.cancellations.value.toLocaleString()}
              current={k.cancellations.value}
              prev={k.cancellations.prev}
              goodWhenDown
              sub={ta.kpiCancellationsSub(rangeLabel)}
            />
          </div>
        </Section>
      </div>

      {/* Episode-gated funnels (one card per gated show) */}
      {episodeFunnels.map((ef) => (
        <Section
          key={ef.showSlug}
          title={ta.episodeFunnelTitle(ef.showTitle)}
          hint={ta.episodeFunnelHint(ef.freeCount, ef.memberCount, rangeLabel)}
        >
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <div>
              {/* Stage shape adapts to the show's tier config: with no
                  member episodes (e.g. thunder-lady post pay-first retier)
                  the wall after the free tier IS the subscription paywall,
                  and the two member-tier stages would read a hard 0 forever
                  beneath a nonzero "Subscribed" — an impossible-looking
                  funnel — so they are dropped and the wall stage relabeled. */}
              <FunnelChart
                steps={[
                  {
                    label: ta.efStarted,
                    value: ef.started,
                    hint: ta.efStartedHint,
                  },
                  ef.memberCount > 0
                    ? {
                        label: ta.efWallHit,
                        value: ef.wallHit,
                        hint: ta.efWallHitHint,
                      }
                    : {
                        label: ta.efPaywallDirect,
                        value: ef.wallHit,
                        hint: ta.efPaywallDirectHint,
                      },
                  {
                    label: ta.efSignedUp,
                    value: ef.signedUp,
                    hint: ta.efSignedUpHint,
                  },
                  ...(ef.memberCount > 0
                    ? [
                        {
                          label: ta.efMemberWatchers,
                          value: ef.memberWatchers,
                          hint: ta.efMemberWatchersHint,
                        },
                        {
                          label: ta.efPaywallHit,
                          value: ef.paywallHit,
                          hint: ta.efPaywallHitHint,
                        },
                      ]
                    : []),
                  {
                    label: ta.efSubscribed,
                    value: ef.subscribed,
                    hint: ta.efSubscribedHint,
                  },
                ]}
              />
              {ef.memberEpisodes.length > 0 ? (
                <div className="mt-5">
                  <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-white/45">
                    {ta.efMemberEpisodesLabel}
                  </p>
                  <BarList
                    items={ef.memberEpisodes.map((m) => ({
                      label: m.label,
                      value: m.viewers,
                      sub: ta.efCompleted(m.completed),
                    }))}
                    format={(n) => ta.efViewers(n)}
                    emptyLabel={ta.efNoMemberViews}
                  />
                </div>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-white/45">
                {ta.efDepthLabel}
              </p>
              <Histogram bars={ef.depth} />
              <p className="mt-3 text-[10px] leading-relaxed text-white/35">
                {ta.efDepthNote}
              </p>
            </div>
          </div>
        </Section>
      ))}

      {/* Time series */}
      <Section
        title={ta.sectionTrend}
        hint={`${rangeLabel} · ${ta.granularityToken(filters.granularity)}`}
      >
        <TimeSeriesChart series={d.series} granularity={filters.granularity} />
      </Section>

      {/* Campaign table */}
      <Section
        title={ta.sectionChannelsCampaigns(touchLabel)}
        hint={
          filters.attribution === "first"
            ? ta.sectionChannelsCampaignsHintFirst
            : ta.sectionChannelsCampaignsHintLast
        }
      >
        <CampaignTable rows={d.campaign} t={t} />
      </Section>

      {/* Trial preview depth */}
      <Section
        title={ta.sectionTrialPreviewDepth}
        hint={ta.sectionTrialPreviewDepthHint}
      >
        <Histogram bars={d.depthHistogram} />
      </Section>

      {/* Engagement + Top shows */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title={ta.sectionSubscriberEngagement}
          hint={ta.sectionSubscriberEngagementHint}
        >
          <div className="grid grid-cols-2 gap-3">
            <KpiTile
              label={ta.kpiCompletionRate}
              value={`${d.engagement.completionRate.toFixed(0)}%`}
              sub={ta.kpiCompletionRateSub(
                d.engagement.completedRows,
                d.engagement.watchRows,
              )}
              approx
            />
            <KpiTile
              label={ta.kpiAvgPctWatched}
              value={`${d.engagement.avgPctWatched.toFixed(0)}%`}
              sub={ta.kpiSampleSize(d.engagement.watchRows)}
              approx
            />
            <KpiTile
              label={ta.kpiAvgPerViewer}
              value={ta.minutes(d.engagement.avgMinPerViewer)}
              sub={ta.kpiViewersCount(d.engagement.distinctViewers)}
              approx
            />
            <KpiTile
              label={ta.kpiWatchRows}
              value={d.engagement.watchRows.toLocaleString()}
              sub={ta.kpiWatchRowsSub}
            />
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-white/35">
            {ta.engagementApproxNote}
          </p>
        </Section>

        <Section
          title={ta.sectionTopShows}
          hint={ta.sectionTopShowsHint}
        >
          <BarList
            items={d.topShows.map((s) => ({
              label: s.title,
              href: `/shows/${s.slug}`,
              value: s.seconds,
              sub: ta.topShowsRowSub(
                s.viewers,
                s.plays > 0 ? Math.round((s.completed / s.plays) * 100) : 0,
              ),
            }))}
            format={(sec) => ta.minutes(Math.round(sec / 60).toLocaleString())}
            emptyLabel={ta.topShowsEmpty}
          />
        </Section>
      </div>

      {/* Mux real watch time — its own Suspense island: the Mux Data API is
          an external HTTP call (3.5s-bounded in lib/mux-data.ts) and must
          never gate the DB-backed sections above, which stream immediately. */}
      <Suspense
        fallback={
          <Section title={ta.sectionWatchTimeMux}>
            <div className="h-28 animate-pulse rounded-lg bg-white/[0.04]" />
          </Section>
        }
      >
        <MuxDataSection filters={filters} />
      </Suspense>
    </div>
  );
}

// Async server component so the external Mux Data fetch streams in behind
// the rest of the dashboard (see the Suspense boundary at the call site).
async function MuxDataSection({ filters }: { filters: Filters }) {
  const { t } = await getAdminDict();
  const ta = t.analytics;
  const muxTf = muxTimeframeForDays(
    (filters.to.getTime() - filters.from.getTime()) / (24 * 60 * 60 * 1000),
  );
  const mux = await getMuxData(muxTf.timeframe);
  return (
    <Section
      title={ta.sectionWatchTimeMux}
      hint={ta.sectionWatchTimeMuxHint(muxWindowLabel(muxTf.timeframe, ta))}
    >
      {muxTf.clamped ? (
        <p className="mb-3 rounded-lg border border-[#f5c451]/25 bg-[#f5c451]/[0.06] px-3 py-2 text-[11px] text-[#f5c451]">
          {ta.muxClampedNotice}
        </p>
      ) : null}
      {mux.status === "not_configured" ? (
        <p className="py-6 text-center text-sm leading-relaxed text-white/55">
          {ta.muxNotConnectedPrefix}{" "}
          <span className="font-mono text-white/70">Mux Data: Read</span>{" "}
          {ta.muxNotConnectedAs}{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
            MUX_DATA_API_TOKEN_ID
          </code>{" "}
          /{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
            MUX_DATA_API_TOKEN_SECRET
          </code>
          .
        </p>
      ) : mux.status === "no_data" ? (
        <p className="py-6 text-center text-sm text-white/55">
          {ta.muxNoData}
        </p>
      ) : mux.status === "error" ? (
        <div className="py-6 text-center">
          <p className="text-sm text-white/55">{ta.muxError}</p>
          {/* Raw detail for diagnostics (token-permission hints, HTTP codes)
              — deliberately small; the headline above is the localized copy. */}
          <p className="mt-1 font-mono text-[10px] text-white/30">
            {mux.message}
          </p>
        </div>
      ) : (
        <MuxPanel summary={mux.summary} byShow={mux.byShow} t={t} />
      )}
    </Section>
  );
}

function MuxPanel({
  summary,
  byShow,
  t,
}: {
  summary: { watchTimeMs: number; views: number; uniqueViewers: number };
  byShow: { show: string; views: number; watchTimeMs: number }[];
  t: AdminDict;
}) {
  const ta = t.analytics;
  const hours = summary.watchTimeMs / 3_600_000;
  const avgViewMin =
    summary.views > 0 ? summary.watchTimeMs / summary.views / 60_000 : 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          label={ta.kpiTotalWatchTime}
          value={ta.hours(hours.toFixed(1))}
          sub={ta.minutes(Math.round(summary.watchTimeMs / 60_000).toLocaleString())}
        />
        <KpiTile label={ta.kpiViews} value={summary.views.toLocaleString()} />
        <KpiTile
          label={ta.kpiUniqueViewers}
          value={summary.uniqueViewers.toLocaleString()}
        />
        <KpiTile
          label={ta.kpiAvgView}
          value={ta.minutes(avgViewMin.toFixed(1))}
          sub={ta.kpiAvgViewSub}
        />
      </div>
      {byShow.length > 0 ? (
        <BarList
          items={byShow.slice(0, 10).map((s) => ({
            label: s.show,
            value: s.watchTimeMs,
            sub: ta.muxByShowViews(s.views),
          }))}
          format={(ms) => ta.minutes(Math.round(ms / 60_000).toLocaleString())}
        />
      ) : null}
    </div>
  );
}

function CampaignTable({
  rows,
  t,
}: {
  rows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    trials: number;
    walled: number;
    signups: number;
    activeSubs: number;
    mrr: number;
  }[];
  t: AdminDict;
}) {
  const ta = t.analytics;
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-white/55">
        {ta.campaignTableEmpty}
      </p>
    );
  }
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-white/45">
            <th className="px-5 py-2 text-left font-semibold">
              {ta.tableColCampaign}
            </th>
            <th className="px-3 py-2 text-left font-semibold">
              {ta.tableColSourceMedium}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tableColTrials}
            </th>
            <th
              className="px-3 py-2 text-right font-semibold"
              title={ta.tableColWallTitle}
            >
              {ta.tableColWall}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tableColSignups}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tableColSubs}
            </th>
            <th
              className="px-3 py-2 text-right font-semibold"
              title={ta.tableColTrialToSubTitle}
            >
              {ta.tableColTrialToSub}
            </th>
            <th className="px-5 py-2 text-right font-semibold">
              {ta.tableColMrr}
            </th>
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
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/55">
                  {r.trials > 0
                    ? `${Math.round((r.walled / r.trials) * 100)}%`
                    : "—"}
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
      <p className="mt-3 px-5 text-[10px] leading-relaxed text-white/35">
        {ta.campaignSessionsNote}
      </p>
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

function filterScopeLabel(
  status: string,
  ta: AdminDict["analytics"],
): string {
  if (status === "active") return ta.scopeActiveOnly;
  if (status === "all") return ta.scopeAllStatuses;
  // Default 'ag' scope: the donut now genuinely filters to access-granting
  // statuses, so the label must say so — "all statuses shown" here would
  // hide the canceled slice while claiming completeness.
  return ta.scopeAccessGranting;
}

function muxWindowLabel(tf: string, ta: AdminDict["analytics"]): string {
  if (tf === "24:hours") return ta.rangeLast24Hours;
  if (tf === "7:days") return ta.rangeLast7Days;
  return ta.rangeLast30Days;
}
