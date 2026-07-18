import { Suspense } from "react";
import Link from "next/link";
import {
  campaignLabel,
  DIRECT_BUCKET,
  loadDashboard,
  loadEpisodeFunnels,
  loadFreeShowDepth,
  loadSignupFunnelDb,
  loadTrackedLinks,
  parseFilters,
  type AnalyticsFilters as Filters,
  type TrackedLinkRow,
} from "@/lib/admin-analytics";
import { paymentsEnabled, signupRequired } from "@/lib/free-mode";
import { getMuxData, muxTimeframeForDays } from "@/lib/mux-data";
import { getSignupFunnelStats, signupFunnelWindow } from "@/lib/posthog-query";
import { AnalyticsFilters } from "@/components/admin/analytics-filters";
import { TimeSeriesChart } from "@/components/admin/time-series-chart";
import { CopyButton } from "@/components/admin/copy-button";
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

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}` : "0";
}

export async function LegacyDashboard({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { t } = await getAdminDict();
  const ta = t.analytics;
  // Free pivot: with payments off the dashboard reorganizes around the
  // organic funnel (sessions → depth → signups). Paid panels aren't deleted
  // — they render again the moment PAYMENTS_ENABLED=1 comes back.
  const paymentsOn = paymentsEnabled();
  // Signup gate (REQUIRE_SIGNUP): anonymous playback stopped minting
  // trial_sessions rows on 2026-07-16, so the organic-funnel panels stop
  // filling — the flag drives the explanatory note on that panel.
  const signupGateOn = signupRequired();
  const sp = await searchParams;
  const filters = parseFilters(sp, new Date());
  const [d, episodeFunnels, trackedLinks, freeShowDepth] = await Promise.all([
    loadDashboard(filters, paymentsOn),
    // Tier-gated episode funnels describe walls that don't exist in free
    // mode; the per-show depth cards below replace them there.
    paymentsOn ? loadEpisodeFunnels(filters) : Promise.resolve([]),
    loadTrackedLinks({ from: filters.from, to: filters.to }),
    paymentsOn ? Promise.resolve([]) : loadFreeShowDepth(filters),
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
  const campaignFilterLabel =
    filters.campaign === "all" ? null : filters.campaign;

  // Sparklines from the time series (period-scoped flow metrics).
  const sparkTrials = d.series.map((p) => p.trials);
  const sparkSignups = d.series.map((p) => p.signups);
  const sparkConversions = d.series.map((p) => p.conversions);
  const sparkFree = d.series.map((p) => p.free);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gold">
            {ta.eyebrow}
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-extrabold tracking-tight text-cream">
            {ta.heading}
            {!paymentsOn ? (
              <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-gold">
                {ta.freeModeBadge}
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-cream/55">
            {rangeLabel}
            {/* Resolved absolute window so a bookmarked relative-range URL
                shows its actual dates; skipped for all-time (the 2020 floor
                is an implementation detail, not a data boundary). */}
            {filters.preset !== "all"
              ? ` (${filters.from.toISOString().slice(0, 10)} → ${filters.to.toISOString().slice(0, 10)})`
              : ""}
            {showLabel ? ` · ${showLabel}` : ""}
            {channelLabel ? ` · ${channelLabel}` : ""}
            {campaignFilterLabel ? ` · ${campaignFilterLabel}` : ""}
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
        paymentsOn={paymentsOn}
      />

      {/* KPI row */}
      {paymentsOn ? (
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
            // Break out how many new subs came via the pay-first guest checkout —
            // those accounts are excluded from the Signups KPI by design, so this
            // is where they surface on the dashboard.
            sub={
              k.guestSignups.value > 0
                ? ta.kpiNewSubsGuestSub(rangeLabel, k.guestSignups.value)
                : rangeLabel
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
          <KpiTile
            label={ta.kpiFreeSessions}
            value={d.free.sessions.value.toLocaleString()}
            current={d.free.sessions.value}
            prev={d.free.sessions.prev}
            spark={sparkFree}
            sub={ta.kpiFreeSessionsSub(d.free.viewers)}
          />
          <KpiTile
            label={ta.kpiPlayed}
            value={d.free.played.value.toLocaleString()}
            current={d.free.played.value}
            prev={d.free.played.prev}
            sub={ta.kpiPctOfSessions(pct(d.free.played.value, d.free.sessions.value))}
          />
          <KpiTile
            label={ta.kpiEngaged2}
            value={d.free.engaged2.value.toLocaleString()}
            current={d.free.engaged2.value}
            prev={d.free.engaged2.prev}
            sub={ta.kpiPctOfSessions(pct(d.free.engaged2.value, d.free.sessions.value))}
          />
          <KpiTile
            label={ta.kpiAvgDepth}
            value={d.free.avgDepth.toFixed(1)}
            sub={ta.kpiAvgDepthSub}
          />
          <KpiTile
            label={ta.kpiSignups}
            value={k.signups.value.toLocaleString()}
            current={k.signups.value}
            prev={k.signups.prev}
            spark={sparkSignups}
            sub={rangeLabel}
          />
        </div>
      )}

      {/* Signup-gate funnel — its own Suspense island: the PostHog query API
          is an external HTTP call (3.5s-bounded in lib/posthog-query.ts) and
          must never gate the DB-backed sections, same contract as the Mux
          panel below. Rendered whenever payments are off: once REQUIRE_SIGNUP
          stops minting trial_sessions rows (2026-07-16) the anonymous top of
          funnel exists only in PostHog. */}
      {!paymentsOn ? (
        <Suspense
          fallback={
            <Section title={ta.sectionSignupFunnel}>
              <div className="h-28 animate-pulse rounded-lg bg-white/[0.04]" />
            </Section>
          }
        >
          <SignupFunnelSection filters={filters} />
        </Suspense>
      ) : null}

      {/* Funnel + (status mix | sources) */}
      {paymentsOn ? (
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
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <Section
            title={ta.sectionOrganicFunnel}
            hint={ta.sectionOrganicFunnelHint}
          >
            <FunnelChart
              steps={[
                {
                  label: ta.ofSessions,
                  value: d.free.sessions.value,
                  hint: ta.ofSessionsHint,
                },
                {
                  label: ta.ofPlayed,
                  value: d.free.played.value,
                  hint: ta.ofPlayedHint,
                },
                {
                  label: ta.ofEngaged2,
                  value: d.free.engaged2.value,
                  hint: ta.ofEngaged2Hint,
                },
                {
                  label: ta.ofEngaged3,
                  value: d.free.engaged3,
                  hint: ta.ofEngaged3Hint,
                },
              ]}
            />
            <p className="mt-4 text-[10px] leading-relaxed text-white/35">
              {ta.organicDepthNote(d.free.avgDepth.toFixed(1))}
            </p>
            {signupGateOn ? (
              <p className="mt-2 text-[10px] leading-relaxed text-[#f5c451]/80">
                {ta.ofGateNote}
              </p>
            ) : null}
          </Section>

          <Section
            title={ta.sectionSources}
            hint={`${touchLabel} · ${rangeLabel}`}
          >
            <BarList
              items={d.sources.map((s) => ({
                label: s.source ?? DIRECT_BUCKET,
                value: s.sessions,
                sub: ta.sourceRowSub(s.viewers),
              }))}
              format={(n) => ta.sourceSessionsCount(n)}
              emptyLabel={ta.sourcesEmpty}
            />
          </Section>
        </div>
      )}

      {/* Episode-gated funnels (one card per gated show — paid mode only) */}
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

      {/* Campaign table */}
      <Section
        title={ta.sectionChannelsCampaigns(touchLabel)}
        hint={
          filters.attribution === "first"
            ? ta.sectionChannelsCampaignsHintFirst
            : ta.sectionChannelsCampaignsHintLast
        }
      >
        {paymentsOn ? (
          <CampaignTable rows={d.campaign} t={t} />
        ) : (
          <FreeCampaignTable rows={d.campaign} t={t} />
        )}
      </Section>

      {/* Tracked links (generator lives at /admin/links) */}
      <Section
        title={ta.sectionTrackedLinks}
        hint={ta.sectionTrackedLinksHint}
        right={
          <Link
            href="/admin/links"
            className="text-[11px] font-semibold text-gold transition-colors hover:text-gold-hi"
          >
            {ta.trackedLinksManage}
          </Link>
        }
      >
        <TrackedLinksTable rows={trackedLinks} t={t} />
      </Section>

      {/* Time series */}
      <Section
        title={ta.sectionTrend}
        hint={`${rangeLabel} · ${ta.granularityToken(filters.granularity)}`}
      >
        <TimeSeriesChart
          series={d.series}
          granularity={filters.granularity}
          freeMode={!paymentsOn}
        />
      </Section>

      {/* Trial preview depth (paid mode — previews don't exist in free mode) */}
      {paymentsOn ? (
        <Section
          title={ta.sectionTrialPreviewDepth}
          hint={ta.sectionTrialPreviewDepthHint}
        >
          <Histogram bars={d.depthHistogram} />
        </Section>
      ) : null}

      {/* Per-show depth (free mode) */}
      {freeShowDepth.map((s) => (
        <Section
          key={s.showSlug}
          title={ta.showDepthTitle(s.showTitle)}
          hint={ta.showDepthHint(s.started, rangeLabel)}
        >
          <Histogram bars={s.depth} />
          <p className="mt-3 text-[10px] leading-relaxed text-white/35">
            {ta.showDepthBarsNote} {ta.showDepthPlayed(s.played.toLocaleString())}
          </p>
        </Section>
      ))}

      {/* Engagement + Top shows */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title={
            paymentsOn
              ? ta.sectionSubscriberEngagement
              : ta.sectionSignedInEngagement
          }
          hint={
            paymentsOn
              ? ta.sectionSubscriberEngagementHint
              : ta.sectionSignedInEngagementHint
          }
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

// Async server component behind its own Suspense boundary (see call site) —
// mirrors MuxDataSection: the external PostHog call streams in behind the
// DB-backed panels. Visitors/Wall come from PostHog (consent-gated floor);
// Signups/Watching come from loadSignupFunnelDb — both range-only, no
// attribution filters, so all four stages describe the same population.
async function SignupFunnelSection({ filters }: { filters: Filters }) {
  const { t } = await getAdminDict();
  const ta = t.analytics;
  // One shared rounded window (5-minute edges, cache-key-stable) for BOTH
  // data sources so the PostHog and DB stages cover an identical time span.
  const win = signupFunnelWindow(filters.from, filters.to);
  const [ph, dbStages] = await Promise.all([
    getSignupFunnelStats(win.from, win.to),
    loadSignupFunnelDb(win),
  ]);
  return (
    <Section title={ta.sectionSignupFunnel} hint={ta.signupFunnelHint}>
      {ph.status === "not_configured" ? (
        <p className="py-6 text-center text-sm leading-relaxed text-white/55">
          {ta.sfNotConnected1}{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
            query:read
          </code>{" "}
          {ta.sfNotConnected2}{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
            POSTHOG_PERSONAL_API_KEY
          </code>{" "}
          /{" "}
          <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
            POSTHOG_PROJECT_ID
          </code>
          .
        </p>
      ) : ph.status === "error" ? (
        <div className="py-6 text-center">
          <p className="text-sm text-white/55">{ta.sfError}</p>
          {/* Raw detail for diagnostics (key-scope hints, HTTP codes) —
              deliberately small; the headline above is the localized copy. */}
          <p className="mt-1 font-mono text-[10px] text-white/30">
            {ph.message}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div>
            <FunnelChart
              steps={[
                {
                  label: ta.sfVisitors,
                  value: ph.stats.visitors,
                  hint: ta.sfVisitorsHint,
                },
                {
                  label: ta.sfWall,
                  value: ph.stats.wallViewers,
                  hint: ta.sfWallHint,
                },
                {
                  label: ta.sfSignups,
                  value: dbStages.signups,
                  hint: ta.sfSignupsHint,
                },
                {
                  label: ta.sfWatching,
                  value: dbStages.watchers,
                  hint: ta.sfWatchingHint,
                },
              ]}
            />
            <p className="mt-4 text-[10px] leading-relaxed text-white/35">
              {ta.sfConsentNote}
            </p>
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.08em] text-white/45">
              {ta.sfBySourceLabel}
            </p>
            <BarList
              items={ph.stats.bySource.map((s) => ({
                label: s.source,
                value: s.visitors,
                sub: ta.sfSourceRowSub(s.wall),
              }))}
              format={(n) => ta.sfVisitorsCount(n)}
              emptyLabel={ta.sfBySourceEmpty}
            />
          </div>
        </div>
      )}
    </Section>
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

type CampaignRows = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  trials: number;
  walled: number;
  signups: number;
  activeSubs: number;
  mrr: number;
  viewers: number;
  played: number;
  deep: number;
  depthSum: number;
}[];

function CampaignTable({ rows, t }: { rows: CampaignRows; t: AdminDict }) {
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

// Free-mode campaign table: engagement columns instead of the dead
// Subs / MRR / Wall% ones — sessions, played %, average episode depth,
// 2+-episode share and (first-touch) signups per campaign.
function FreeCampaignTable({ rows, t }: { rows: CampaignRows; t: AdminDict }) {
  const ta = t.analytics;
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-white/55">
        {ta.campaignTableEmpty}
      </p>
    );
  }
  const sorted = [...rows].sort((a, b) => b.trials - a.trials);
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
              {ta.tableColSessions}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tableColPlayedPct}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tableColAvgEps}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tableColDeepPct}
            </th>
            <th className="px-5 py-2 text-right font-semibold">
              {ta.tableColSignups}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const label = campaignLabel(r.source, r.medium, r.campaign);
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
                    ? `${Math.round((r.played / r.trials) * 100)}%`
                    : "—"}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/55">
                  {r.played > 0 ? (r.depthSum / r.played).toFixed(1) : "—"}
                </td>
                <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/55">
                  {r.trials > 0
                    ? `${Math.round((r.deep / r.trials) * 100)}%`
                    : "—"}
                </td>
                <td className="px-5 py-3 text-right align-top font-mono text-xs text-white/75">
                  {r.signups.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 px-5 text-[10px] leading-relaxed text-white/35">
        {ta.campaignFreeNote}
      </p>
    </div>
  );
}

function TrackedLinksTable({
  rows,
  t,
}: {
  rows: TrackedLinkRow[];
  t: AdminDict;
}) {
  const ta = t.analytics;
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-white/55">
        {ta.trackedLinksEmpty}
      </p>
    );
  }
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.08em] text-white/45">
            <th className="px-5 py-2 text-left font-semibold">{ta.tlColName}</th>
            <th className="px-3 py-2 text-left font-semibold">
              {ta.tlColTarget}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tlColSessions}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tlColPlayed}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tlColSignups}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {ta.tlColAllTime}
            </th>
            <th className="px-5 py-2 text-right font-semibold" />
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-t border-white/[0.05]">
              <td className="px-5 py-3 align-top">
                <p className="text-sm font-semibold text-white">{l.name}</p>
                <p className="mt-0.5 font-mono text-[11px] text-white/40">
                  {l.source} · {l.medium} · {l.campaign}
                </p>
              </td>
              <td className="px-3 py-3 align-top font-mono text-xs text-white/55">
                {l.targetPath}
              </td>
              <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/75">
                {l.sessions.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/55">
                {l.played.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/75">
                {l.signups.toLocaleString()}
              </td>
              <td className="px-3 py-3 text-right align-top font-mono text-xs text-white/55">
                {l.allTimeSessions.toLocaleString()}
              </td>
              <td className="px-5 py-3 text-right align-top">
                <CopyButton value={l.url} name={l.name} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  hint,
  right,
  children,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        <div className="flex items-baseline gap-3">
          {hint ? (
            <span className="text-right text-[11px] text-white/45">{hint}</span>
          ) : null}
          {right}
        </div>
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
