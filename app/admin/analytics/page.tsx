import Link from "next/link";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
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

// Plan prices (USD). Match the values in scripts/stripe-setup.ts. Past-due
// subscriptions are intentionally excluded from MRR and active count below —
// they're behind on payment, so we shouldn't claim that revenue.
const MONTHLY_PRICE = 9.99;
const ANNUAL_PRICE = 79.99;

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
    db
      .select({
        title: shows.title,
        slug: shows.slug,
        seconds: sql<number>`COALESCE(SUM(${watchProgress.positionSeconds}), 0)::int`,
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
  ]);

  const totalUsers = totalUsersRow[0].n;
  const recentUsers = recentUsersRow[0].n;

  const monthlySubs =
    activeSubsByPlan.find((r) => r.plan === "monthly")?.n ?? 0;
  const annualSubs = activeSubsByPlan.find((r) => r.plan === "annual")?.n ?? 0;
  const activeCount = monthlySubs + annualSubs;
  // MRR: monthly plan = full price; annual plan = price / 12.
  const mrr = monthlySubs * MONTHLY_PRICE + annualSubs * (ANNUAL_PRICE / 12);

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total signups" value={String(totalUsers)} />
        <Metric label="Signups · 30d" value={String(recentUsers)} />
        <Metric label="Active subscriptions" value={String(activeCount)} />
        <Metric
          label="MRR"
          value={`$${mrr.toFixed(2)}`}
          sub={`${monthlySubs} monthly · ${annualSubs} annual`}
        />
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
        <Metric
          label="Monthly plan rev"
          value={`$${(monthlySubs * MONTHLY_PRICE).toFixed(2)}/mo`}
        />
        <Metric
          label="Annual plan rev"
          value={`$${(annualSubs * ANNUAL_PRICE).toFixed(2)}/yr`}
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
                  <span className="w-20 text-right font-mono text-xs text-white/65">
                    {minutes.toLocaleString()} min
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-center text-[10px] text-white/35">
        Mux Data video-quality metrics will be wired in a follow-up.
      </p>
    </div>
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
