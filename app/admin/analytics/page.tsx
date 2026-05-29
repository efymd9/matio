import Link from "next/link";
import { and, count, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  subscriptions,
  trialSessions,
  users,
  watchProgress,
} from "@/db/schema";
import {
  getMuxData,
  type MuxShowRow,
  type MuxWatchSummary,
} from "@/lib/mux-data";

// Plan price (USD). Match the value in scripts/stripe-setup.ts. Past-due
// subscriptions are intentionally excluded from MRR and active count below —
// they're behind on payment, so we shouldn't claim that revenue. Historical
// 'annual' rows (pre-launch test data) are ignored: that plan isn't sold
// anymore and there shouldn't be any in production.
const MONTHLY_PRICE = 38;

// Stable key for grouping campaign rows across the four independent
// queries (trials, signups, subs, MRR). NULL columns collapse to a
// shared "(direct)" bucket — organic / direct traffic carries no UTM
// cookies and we want a single row for the unattributed pool, not one
// per NULL combination.
const DIRECT_BUCKET = "(direct)";
function campaignKey(
  source: string | null,
  medium: string | null,
  campaign: string | null,
): string {
  return [source ?? "", medium ?? "", campaign ?? ""].join("|");
}
function campaignLabel(
  source: string | null,
  medium: string | null,
  campaign: string | null,
): { source: string; medium: string; campaign: string; isDirect: boolean } {
  const isDirect = source === null && medium === null && campaign === null;
  return {
    source: source ?? DIRECT_BUCKET,
    medium: medium ?? DIRECT_BUCKET,
    campaign: campaign ?? DIRECT_BUCKET,
    isDirect,
  };
}

export default async function AnalyticsPage() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsersRow,
    recentUsersRow,
    activeSubsByPlan,
    cancelledRecentRow,
    trialsRecentRow,
    convertedTrialsRecentRow,
    topShowsRows,
    dailySignupRows,
    // Campaign breakdown queries. Each runs independently grouped by the
    // (source, medium, campaign) triple of either the first-touch or
    // last-touch attribution columns. We merge in JS rather than try to
    // pivot/full-outer-join in SQL — simpler and the row count is small
    // (one row per campaign per dimension; typically <50 even at scale).
    firstTouchTrialsRows,
    firstTouchSignupsRows,
    firstTouchSubsRows,
    lastTouchTrialsRows,
    lastTouchSignupsRows,
    lastTouchSubsRows,
    watchEngagementRow,
    avgCompletionRow,
    trialDepthRow,
    muxDataResult,
  ] = await Promise.all([
    db.select({ n: count() }).from(users),
    db
      .select({ n: count() })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo)),
    db
      .select({ plan: subscriptions.plan, n: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(subscriptions.plan),
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "canceled"),
          gte(subscriptions.updatedAt, thirtyDaysAgo),
        ),
      ),
    db
      .select({ n: count() })
      .from(trialSessions)
      .where(gte(trialSessions.startedAt, thirtyDaysAgo)),
    db
      .select({ n: count() })
      .from(trialSessions)
      .where(
        and(
          gte(trialSessions.startedAt, thirtyDaysAgo),
          eq(trialSessions.converted, true),
        ),
      ),
    // Top shows by total watched seconds (sum of every viewer's
    // last-known position per episode). Not perfect for repeat-watching
    // — we don't have per-session event logs — but a useful proxy at v1.
    // Also returns distinct viewers and a completion ratio per show.
    db
      .select({
        title: shows.title,
        slug: shows.slug,
        seconds: sql<number>`COALESCE(SUM(${watchProgress.positionSeconds}), 0)::int`,
        viewers: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
        completed: sql<number>`COUNT(*) FILTER (WHERE ${watchProgress.completed})::int`,
        plays: sql<number>`COUNT(*)::int`,
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(watchProgress.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(shows, eq(seasons.showId, shows.id))
      .groupBy(shows.id, shows.title, shows.slug)
      .orderBy(desc(sql`SUM(${watchProgress.positionSeconds})`))
      .limit(10),
    // Daily signup buckets. We do the GROUP BY in SQL and fill missing
    // days in JS so the chart always renders 30 bars.
    db
      .select({
        day: sql<string>`TO_CHAR(${users.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        n: count(),
      })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo))
      .groupBy(sql`TO_CHAR(${users.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`),
    // ----- First-touch campaign breakdown -----
    db
      .select({
        source: trialSessions.attributionFirstSource,
        medium: trialSessions.attributionFirstMedium,
        campaign: trialSessions.attributionFirstCampaign,
        n: count(),
      })
      .from(trialSessions)
      .where(gte(trialSessions.startedAt, thirtyDaysAgo))
      .groupBy(
        trialSessions.attributionFirstSource,
        trialSessions.attributionFirstMedium,
        trialSessions.attributionFirstCampaign,
      ),
    db
      .select({
        source: users.attributionFirstSource,
        medium: users.attributionFirstMedium,
        campaign: users.attributionFirstCampaign,
        n: count(),
      })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo))
      .groupBy(
        users.attributionFirstSource,
        users.attributionFirstMedium,
        users.attributionFirstCampaign,
      ),
    db
      .select({
        source: subscriptions.attributionFirstSource,
        medium: subscriptions.attributionFirstMedium,
        campaign: subscriptions.attributionFirstCampaign,
        plan: subscriptions.plan,
        n: count(),
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(
        subscriptions.attributionFirstSource,
        subscriptions.attributionFirstMedium,
        subscriptions.attributionFirstCampaign,
        subscriptions.plan,
      ),
    // ----- Last-touch campaign breakdown -----
    db
      .select({
        source: trialSessions.attributionLastSource,
        medium: trialSessions.attributionLastMedium,
        campaign: trialSessions.attributionLastCampaign,
        n: count(),
      })
      .from(trialSessions)
      .where(gte(trialSessions.startedAt, thirtyDaysAgo))
      .groupBy(
        trialSessions.attributionLastSource,
        trialSessions.attributionLastMedium,
        trialSessions.attributionLastCampaign,
      ),
    db
      .select({
        source: users.attributionLastSource,
        medium: users.attributionLastMedium,
        campaign: users.attributionLastCampaign,
        n: count(),
      })
      .from(users)
      .where(gte(users.createdAt, thirtyDaysAgo))
      .groupBy(
        users.attributionLastSource,
        users.attributionLastMedium,
        users.attributionLastCampaign,
      ),
    db
      .select({
        source: subscriptions.attributionLastSource,
        medium: subscriptions.attributionLastMedium,
        campaign: subscriptions.attributionLastCampaign,
        plan: subscriptions.plan,
        n: count(),
      })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(
        subscriptions.attributionLastSource,
        subscriptions.attributionLastMedium,
        subscriptions.attributionLastCampaign,
        subscriptions.plan,
      ),
    // ----- Engagement (subscribers) -----
    // Completion rate, distinct viewers, and total watched seconds across all
    // watch_progress rows. `completed` is set true on onEnded; positionSeconds
    // is the last-saved playhead per (user, episode) — a resume position, so
    // totals are an approximation, not true cumulative minutes.
    db
      .select({
        total: count(),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${watchProgress.completed})::int`,
        viewers: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
        seconds: sql<number>`COALESCE(SUM(${watchProgress.positionSeconds}), 0)::int`,
      })
      .from(watchProgress),
    // Average % of episode watched (last position / duration), clamped to 100%.
    // Guard out episodes with no duration (still processing / errored) to avoid
    // divide-by-zero skew.
    db
      .select({
        pct: sql<number>`COALESCE(AVG(LEAST(${watchProgress.positionSeconds}::float / NULLIF(${episodes.durationSeconds}, 0), 1)) * 100, 0)`,
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(watchProgress.episodeId, episodes.id))
      .where(and(isNotNull(episodes.durationSeconds), gt(episodes.durationSeconds, 0))),
    // Trial preview depth · 30d — how far into the 60s preview anonymous
    // viewers get (last_position_seconds per trial session).
    db
      .select({
        avgDepth: sql<number>`COALESCE(AVG(${trialSessions.lastPositionSeconds}), 0)`,
        withProgress: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.lastPositionSeconds} > 0)::int`,
        total: count(),
      })
      .from(trialSessions)
      .where(gte(trialSessions.startedAt, thirtyDaysAgo)),
    // Real watch-time from the Mux Data API (last 30 days, hero excluded).
    // Server-side, cached 5 min, best-effort — null/hint when unconfigured.
    getMuxData("30:days"),
  ]);

  const totalUsers = totalUsersRow[0].n;
  const recentUsers = recentUsersRow[0].n;

  const monthlySubs =
    activeSubsByPlan.find((r) => r.plan === "monthly")?.n ?? 0;
  const activeCount = monthlySubs;
  const mrr = monthlySubs * MONTHLY_PRICE;

  const cancelledRecent = cancelledRecentRow[0].n;
  // Approximate 30-day churn: cancellations / (cancellations + still-active).
  // True churn would need a snapshot of "active at start of window" which
  // we don't maintain — accept the proxy.
  const churnRate =
    activeCount + cancelledRecent > 0
      ? (cancelledRecent / (activeCount + cancelledRecent)) * 100
      : 0;

  const trialsRecent = trialsRecentRow[0].n;
  const convertedRecent = convertedTrialsRecentRow[0].n;
  const conversionRate =
    trialsRecent > 0 ? (convertedRecent / trialsRecent) * 100 : 0;

  // Fill 30 daily buckets (oldest → newest) so the bar chart is always full.
  const signupMap = new Map(dailySignupRows.map((r) => [r.day, Number(r.n)]));
  const dailyBuckets: { day: string; n: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dailyBuckets.push({ day: key, n: signupMap.get(key) ?? 0 });
  }
  const maxDaily = Math.max(...dailyBuckets.map((b) => b.n), 1);
  const totalDailySignups = dailyBuckets.reduce((acc, b) => acc + b.n, 0);

  const maxShowSeconds =
    topShowsRows.length > 0 ? Number(topShowsRows[0].seconds) : 0;

  const firstTouchRows = mergeCampaignRows(
    firstTouchTrialsRows,
    firstTouchSignupsRows,
    firstTouchSubsRows,
  );
  const lastTouchRows = mergeCampaignRows(
    lastTouchTrialsRows,
    lastTouchSignupsRows,
    lastTouchSubsRows,
  );

  // Engagement (subscribers). All approximate — see the query comments and the
  // note rendered under the section: positionSeconds is the last-saved playhead
  // (resume position), not cumulative watch time. Mux Data (consent-gated)
  // provides true watch-time + retention curves once its env key is set.
  const engagement = watchEngagementRow[0];
  const watchRows = Number(engagement.total);
  const completedRows = Number(engagement.completed);
  const distinctViewers = Number(engagement.viewers);
  const completionRate = watchRows > 0 ? (completedRows / watchRows) * 100 : 0;
  const avgCompletionPct = Number(avgCompletionRow[0].pct);
  const avgWatchedMinPerViewer =
    distinctViewers > 0
      ? Math.round(Number(engagement.seconds) / distinctViewers / 60)
      : 0;
  const trialDepth = trialDepthRow[0];
  const avgTrialDepth = Math.round(Number(trialDepth.avgDepth));
  const trialDepthTotal = Number(trialDepth.total);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff3d3d]">
          Analytics
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-white/55">
          Snapshot · last 30 days where windowed
        </p>
      </div>

      {/* Top-level metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Total signups" value={String(totalUsers)} />
        <Metric label="Signups · 30d" value={String(recentUsers)} />
        <Metric label="Active subscriptions" value={String(activeCount)} />
        <Metric label="MRR" value={`$${mrr.toFixed(2)}`} />
        <Metric
          label="Trial → paid · 30d"
          value={`${conversionRate.toFixed(1)}%`}
          sub={`${convertedRecent}/${trialsRecent} trials`}
        />
        <Metric
          label="Churn · 30d"
          value={`${churnRate.toFixed(1)}%`}
          sub={`${cancelledRecent} cancellations`}
        />
      </div>

      {/* Daily signups histogram */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-white">Signups · daily</h2>
          <span className="text-[11px] text-white/45">
            {totalDailySignups} total
          </span>
        </div>
        <div className="flex h-32 items-end gap-1">
          {dailyBuckets.map((b) => (
            <div
              key={b.day}
              className="group/bar flex h-full flex-1 flex-col items-center justify-end"
              title={`${b.day}: ${b.n}`}
            >
              <div
                className={`w-full rounded-sm transition-colors ${
                  b.n > 0
                    ? "bg-[#ff3d3d]/70 group-hover/bar:bg-[#ff3d3d]"
                    : "bg-white/[0.04]"
                }`}
                style={{
                  height: `${Math.max((b.n / maxDaily) * 100, b.n > 0 ? 4 : 1)}%`,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-white/35">
          <span>{dailyBuckets[0].day}</span>
          <span>today</span>
        </div>
      </section>

      {/* Top shows by watch time */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-white">
            Top shows · watch time
          </h2>
          <span className="text-[11px] text-white/45">
            sum of last-known positions
          </span>
        </div>
        {topShowsRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/55">
            No watch progress recorded yet.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {topShowsRows.map((s, i) => {
              const seconds = Number(s.seconds);
              const minutes = Math.round(seconds / 60);
              const pct =
                maxShowSeconds > 0 ? (seconds / maxShowSeconds) * 100 : 0;
              const plays = Number(s.plays);
              const showCompletion =
                plays > 0 ? Math.round((Number(s.completed) / plays) * 100) : 0;
              return (
                <li key={s.slug} className="flex items-center gap-3">
                  <span className="w-6 font-mono text-xs text-white/45">
                    #{i + 1}
                  </span>
                  <Link
                    href={`/shows/${s.slug}`}
                    className="w-44 shrink-0 truncate text-sm font-semibold text-white transition-colors hover:text-[#ff3d3d]"
                  >
                    {s.title}
                  </Link>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full bg-[#ff3d3d]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-28 shrink-0 text-right font-mono text-[11px] leading-tight text-white/65">
                    {minutes.toLocaleString()} min
                    <span className="block text-white/35">
                      {Number(s.viewers).toLocaleString()} viewer
                      {Number(s.viewers) === 1 ? "" : "s"} · {showCompletion}%
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Campaign attribution */}
      <CampaignSection
        title="By first-touch campaign"
        kicker="Which channel opened the relationship"
        rows={firstTouchRows}
      />
      <CampaignSection
        title="By last-touch campaign"
        kicker="What ad platforms attribute the conversion to"
        rows={lastTouchRows}
      />

      {/* Engagement (subscribers + trial) */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Engagement</h2>
          <span className="text-[11px] text-white/45">watch behaviour</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Completion rate"
            value={`${completionRate.toFixed(0)}%`}
            sub={`${completedRows}/${watchRows} episodes finished`}
          />
          <Metric
            label="Avg % watched"
            value={`${avgCompletionPct.toFixed(0)}%`}
            sub="of episode length"
          />
          <Metric
            label="Avg watched / viewer"
            value={`${avgWatchedMinPerViewer} min`}
            sub={`${distinctViewers} viewer${distinctViewers === 1 ? "" : "s"}`}
          />
          <Metric
            label="Trial preview depth"
            value={`${avgTrialDepth}s`}
            sub={`avg of ${trialDepthTotal} trials · 60s cap`}
          />
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-white/35">
          Approximate — derived from the last-saved playhead per episode (resume
          position), not cumulative minutes. The Mux Data panel below has the
          real watch-time.
        </p>
      </section>

      {/* Real watch time (Mux Data API) */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-bold text-white">Watch time · Mux Data</h2>
          <span className="text-[11px] text-white/45">
            real playback · last 30 days · hero excluded
          </span>
        </div>
        {muxDataResult.status === "not_configured" ? (
          <p className="py-6 text-center text-sm leading-relaxed text-white/55">
            Not connected. Add a Mux access token with{" "}
            <span className="font-mono text-white/70">Mux Data: Read</span>{" "}
            permission as{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
              MUX_DATA_API_TOKEN_ID
            </code>{" "}
            /{" "}
            <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[0.85em]">
              MUX_DATA_API_TOKEN_SECRET
            </code>{" "}
            to show real watch-time here.
          </p>
        ) : muxDataResult.status === "error" ? (
          <p className="py-6 text-center text-sm text-white/55">
            {muxDataResult.message}
          </p>
        ) : (
          <MuxDataPanel
            summary={muxDataResult.summary}
            byShow={muxDataResult.byShow}
          />
        )}
      </section>
    </div>
  );
}

function MuxDataPanel({
  summary,
  byShow,
}: {
  summary: MuxWatchSummary;
  byShow: MuxShowRow[];
}) {
  const hours = summary.watchTimeMs / 3_600_000;
  const totalMinutes = Math.round(summary.watchTimeMs / 60_000);
  const avgViewMin =
    summary.views > 0 ? summary.watchTimeMs / summary.views / 60_000 : 0;
  const maxShowMs =
    byShow.length > 0 ? Math.max(...byShow.map((s) => s.watchTimeMs), 1) : 1;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Total watch time"
          value={`${hours.toFixed(1)} h`}
          sub={`${totalMinutes.toLocaleString()} min`}
        />
        <Metric label="Views" value={summary.views.toLocaleString()} />
        <Metric
          label="Unique viewers"
          value={summary.uniqueViewers.toLocaleString()}
        />
        <Metric
          label="Avg view"
          value={`${avgViewMin.toFixed(1)} min`}
          sub="per view"
        />
      </div>
      {byShow.length > 0 ? (
        <ul className="space-y-2.5">
          {byShow.slice(0, 10).map((s) => {
            const minutes = Math.round(s.watchTimeMs / 60_000);
            const pct = (s.watchTimeMs / maxShowMs) * 100;
            return (
              <li key={s.show} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-sm font-semibold text-white">
                  {s.show}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full bg-[#ff3d3d]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right font-mono text-[11px] leading-tight text-white/65">
                  {minutes.toLocaleString()} min
                  <span className="block text-white/35">
                    {s.views.toLocaleString()} view{s.views === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-center text-xs text-white/45">
          No views recorded yet — Mux Data appears a few minutes after consenting
          viewers watch.
        </p>
      )}
    </div>
  );
}

type CampaignRowAgg = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  trials: number;
  signups: number;
  activeSubs: number;
  mrr: number;
};

function mergeCampaignRows(
  trialsRows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    n: number;
  }[],
  signupsRows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    n: number;
  }[],
  subsRows: {
    source: string | null;
    medium: string | null;
    campaign: string | null;
    plan: "monthly" | "annual";
    n: number;
  }[],
): CampaignRowAgg[] {
  const map = new Map<string, CampaignRowAgg>();
  const upsert = (
    source: string | null,
    medium: string | null,
    campaign: string | null,
  ): CampaignRowAgg => {
    const key = campaignKey(source, medium, campaign);
    let row = map.get(key);
    if (!row) {
      row = {
        source,
        medium,
        campaign,
        trials: 0,
        signups: 0,
        activeSubs: 0,
        mrr: 0,
      };
      map.set(key, row);
    }
    return row;
  };
  for (const r of trialsRows) {
    upsert(r.source, r.medium, r.campaign).trials += Number(r.n);
  }
  for (const r of signupsRows) {
    upsert(r.source, r.medium, r.campaign).signups += Number(r.n);
  }
  // Single plan now — every sub contributes MONTHLY_PRICE to MRR.
  // The subs query still selects/groups by plan; historical 'annual'
  // rows (test data) are treated the same. The plan field is left in
  // the query shape so the SQL doesn't need re-touching.
  for (const r of subsRows) {
    const row = upsert(r.source, r.medium, r.campaign);
    const n = Number(r.n);
    row.activeSubs += n;
    row.mrr += n * MONTHLY_PRICE;
  }
  // Sort by MRR DESC, falling back to trials count for campaigns that
  // haven't produced revenue yet — top-of-funnel volume is still useful
  // signal for a new campaign that just launched.
  return Array.from(map.values()).sort((a, b) => {
    if (b.mrr !== a.mrr) return b.mrr - a.mrr;
    return b.trials - a.trials;
  });
}

function CampaignSection({
  title,
  kicker,
  rows,
}: {
  title: string;
  kicker: string;
  rows: CampaignRowAgg[];
}) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        <span className="text-[11px] text-white/45">{kicker}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-white/55">
          No campaign data yet. Tag landing URLs with utm_source / utm_medium /
          utm_campaign to start attributing.
        </p>
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.08em] text-white/45">
                <th className="px-5 py-2 text-left font-semibold">Campaign</th>
                <th className="px-3 py-2 text-left font-semibold">Source / medium</th>
                <th className="px-3 py-2 text-right font-semibold">Trials · 30d</th>
                <th className="px-3 py-2 text-right font-semibold">Signups · 30d</th>
                <th className="px-3 py-2 text-right font-semibold">Active subs</th>
                <th className="px-5 py-2 text-right font-semibold">MRR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const label = campaignLabel(r.source, r.medium, r.campaign);
                return (
                  <tr
                    key={campaignKey(r.source, r.medium, r.campaign)}
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
                      <span>{label.source}</span>
                      <span className="text-white/30"> · </span>
                      <span>{label.medium}</span>
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
                    <td className="px-5 py-3 text-right align-top font-mono text-xs font-semibold text-white">
                      ${r.mrr.toFixed(2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4">
      <p className="text-[10px] uppercase tracking-[0.08em] text-white/55">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-white">
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-white/45">{sub}</p>
      ) : null}
    </div>
  );
}
