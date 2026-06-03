import "server-only";
import {
  and,
  type AnyColumn,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
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
  muxTimeframeForDays,
  type MuxDataResult,
} from "@/lib/mux-data";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-access";

// ---------------------------------------------------------------------------
// Data layer for /admin/analytics. The page is a server component that parses
// URL searchParams into AnalyticsFilters (parseFilters) and calls loadDashboard
// once; every panel reads from the returned object. Keeping all DB access here
// keeps the page presentational and the queries testable.
// ---------------------------------------------------------------------------

// Single monthly membership price (USD). Match scripts/stripe-setup.ts.
export const MONTHLY_PRICE = 38;

// Organic / direct traffic carries no UTM cookies; it collapses to one bucket
// rather than a row per NULL combination.
export const DIRECT_BUCKET = "(direct)";

const DAY_MS = 24 * 60 * 60 * 1000;
// Lower bound for the "all-time" range. Predates the project; min(createdAt)
// would be exact but this is simpler and the fill loop is capped regardless.
const ALL_TIME_FLOOR = new Date("2020-01-01T00:00:00.000Z");

export type RangePreset = "24h" | "7d" | "30d" | "90d" | "all" | "custom";
export type Granularity = "hour" | "day" | "week" | "month";
export type GranularityChoice = "auto" | Granularity;
export type AttributionModel = "first" | "last";
export type StatusScope = "ag" | "active" | "all"; // access-granting | active | all

export type AnalyticsFilters = {
  preset: RangePreset;
  from: Date;
  to: Date;
  // Previous equal-length window for period-over-period deltas. null for the
  // "all-time" range (no meaningful prior period) and unbounded customs.
  prevFrom: Date | null;
  prevTo: Date | null;
  granularity: Granularity; // resolved
  granularityChoice: GranularityChoice; // as selected (for the control)
  show: string; // "all" | slug
  channel: string; // "all" | source value | DIRECT_BUCKET
  campaign: string; // "all" | campaign value | DIRECT_BUCKET
  attribution: AttributionModel;
  status: StatusScope;
  customFrom: string | null; // YYYY-MM-DD echo for the date inputs
  customTo: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseYmd(v: string | undefined): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function autoGranularity(from: Date, to: Date): Granularity {
  const days = (to.getTime() - from.getTime()) / DAY_MS;
  if (days <= 2) return "hour";
  if (days <= 45) return "day";
  if (days <= 365) return "week";
  return "month";
}

// Pure: URL searchParams → typed, validated filters. Unknown values fall back to
// safe defaults so a hand-edited URL can never throw.
export function parseFilters(sp: RawParams, now: Date): AnalyticsFilters {
  const rangeRaw = one(sp.range);
  const customFromRaw = one(sp.from) ?? null;
  const customToRaw = one(sp.to) ?? null;

  let preset: RangePreset;
  let from: Date;
  let to: Date = now;

  if (rangeRaw === "custom" && parseYmd(customFromRaw ?? undefined)) {
    preset = "custom";
    from = parseYmd(customFromRaw ?? undefined)!;
    const toParsed = parseYmd(customToRaw ?? undefined);
    // Inclusive end-of-day for the "to" date; default to now if omitted.
    to = toParsed ? new Date(toParsed.getTime() + DAY_MS - 1) : now;
    if (to < from) to = new Date(from.getTime() + DAY_MS - 1);
  } else {
    const PRESETS: readonly string[] = ["24h", "7d", "30d", "90d", "all"];
    preset = PRESETS.includes(rangeRaw ?? "")
      ? (rangeRaw as RangePreset)
      : "30d";
    switch (preset) {
      case "24h":
        from = new Date(now.getTime() - 1 * DAY_MS);
        break;
      case "7d":
        from = new Date(now.getTime() - 7 * DAY_MS);
        break;
      case "90d":
        from = new Date(now.getTime() - 90 * DAY_MS);
        break;
      case "all":
        from = ALL_TIME_FLOOR;
        break;
      case "30d":
      default:
        from = new Date(now.getTime() - 30 * DAY_MS);
        break;
    }
  }

  // Previous equal-length window, immediately preceding. Skipped for all-time.
  let prevFrom: Date | null = null;
  let prevTo: Date | null = null;
  if (preset !== "all") {
    const len = to.getTime() - from.getTime();
    prevTo = from;
    prevFrom = new Date(from.getTime() - len);
  }

  const granChoice = ((): GranularityChoice => {
    const g = one(sp.gran);
    const GRANS: readonly string[] = ["auto", "hour", "day", "week", "month"];
    return GRANS.includes(g ?? "") ? (g as GranularityChoice) : "auto";
  })();
  const granularity =
    granChoice === "auto" ? autoGranularity(from, to) : granChoice;

  const attribution: AttributionModel = one(sp.attr) === "last" ? "last" : "first";
  const status = ((): StatusScope =>
    one(sp.status) === "active" ? "active" : one(sp.status) === "all" ? "all" : "ag")();

  return {
    preset,
    from,
    to,
    prevFrom,
    prevTo,
    granularity,
    granularityChoice: granChoice,
    show: one(sp.show) || "all",
    channel: one(sp.channel) || "all",
    campaign: one(sp.campaign) || "all",
    attribution,
    status,
    customFrom: customFromRaw,
    customTo: customToRaw,
  };
}

// ---- attribution column selection (first- vs last-touch) -------------------

function trialSource(model: AttributionModel) {
  return model === "first"
    ? trialSessions.attributionFirstSource
    : trialSessions.attributionLastSource;
}
function trialTriple(model: AttributionModel) {
  return model === "first"
    ? {
        source: trialSessions.attributionFirstSource,
        medium: trialSessions.attributionFirstMedium,
        campaign: trialSessions.attributionFirstCampaign,
      }
    : {
        source: trialSessions.attributionLastSource,
        medium: trialSessions.attributionLastMedium,
        campaign: trialSessions.attributionLastCampaign,
      };
}
function userTriple(model: AttributionModel) {
  return model === "first"
    ? {
        source: users.attributionFirstSource,
        medium: users.attributionFirstMedium,
        campaign: users.attributionFirstCampaign,
      }
    : {
        source: users.attributionLastSource,
        medium: users.attributionLastMedium,
        campaign: users.attributionLastCampaign,
      };
}
function subTriple(model: AttributionModel) {
  return model === "first"
    ? {
        source: subscriptions.attributionFirstSource,
        medium: subscriptions.attributionFirstMedium,
        campaign: subscriptions.attributionFirstCampaign,
      }
    : {
        source: subscriptions.attributionLastSource,
        medium: subscriptions.attributionLastMedium,
        campaign: subscriptions.attributionLastCampaign,
      };
}

// Channel (utm_source) predicate for a given source column. "all" → no filter,
// DIRECT_BUCKET → IS NULL, otherwise exact match. Accepts the source column of
// any of the three tables (trial_sessions / users / subscriptions).
function channelCond(col: AnyColumn, channel: string): SQL | undefined {
  if (channel === "all") return undefined;
  if (channel === DIRECT_BUCKET) return isNull(col);
  return eq(col, channel);
}

// Campaign (utm_campaign) predicate — same shape as channelCond, for the
// campaign column of any of the three tables. "all" → no filter, DIRECT_BUCKET
// → IS NULL (organic), otherwise exact match.
function campaignCond(col: AnyColumn, campaign: string): SQL | undefined {
  if (campaign === "all") return undefined;
  if (campaign === DIRECT_BUCKET) return isNull(col);
  return eq(col, campaign);
}

// date_trunc bucket label, formatted to a stable UTC string that mirrors the
// JS fill loop (bucketKey). `gran` is inlined via sql.raw — safe because it's
// validated against a fixed enum in parseFilters, never raw user input — so the
// SELECT and GROUP BY render textually identical (Postgres requires the match).
function bucketExpr(col: AnyColumn, gran: Granularity) {
  return sql<string>`to_char(date_trunc('${sql.raw(gran)}', ${col} AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')`;
}

// ---- time-series bucket fill ----------------------------------------------

function truncBucket(d: Date, gran: Granularity): Date {
  const x = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()),
  );
  if (gran === "hour") return x;
  x.setUTCHours(0, 0, 0, 0);
  if (gran === "day") return x;
  if (gran === "week") {
    // Postgres date_trunc('week') → Monday.
    const dow = (x.getUTCDay() + 6) % 7;
    x.setUTCDate(x.getUTCDate() - dow);
    return x;
  }
  // month
  x.setUTCDate(1);
  return x;
}

function nextBucket(d: Date, gran: Granularity): Date {
  const x = new Date(d);
  if (gran === "hour") x.setUTCHours(x.getUTCHours() + 1);
  else if (gran === "day") x.setUTCDate(x.getUTCDate() + 1);
  else if (gran === "week") x.setUTCDate(x.getUTCDate() + 7);
  else x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}

function bucketKey(d: Date): string {
  // Mirrors the SQL to_char format above.
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

export type SeriesPoint = {
  key: string;
  signups: number;
  trials: number;
  conversions: number;
  newSubs: number;
};

// Generate every bucket between from..to and merge the per-metric SQL rows so
// the chart always renders a continuous axis. Capped so a pathological
// hour-granularity-over-years range can't spin forever.
function fillSeries(
  from: Date,
  to: Date,
  gran: Granularity,
  maps: Record<keyof Omit<SeriesPoint, "key">, Map<string, number>>,
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let cursor = truncBucket(from, gran);
  const end = to.getTime();
  let guard = 0;
  while (cursor.getTime() <= end && guard < 2000) {
    const key = bucketKey(cursor);
    out.push({
      key,
      signups: maps.signups.get(key) ?? 0,
      trials: maps.trials.get(key) ?? 0,
      conversions: maps.conversions.get(key) ?? 0,
      newSubs: maps.newSubs.get(key) ?? 0,
    });
    cursor = nextBucket(cursor, gran);
    guard++;
  }
  return out;
}

// ---- campaign aggregation (first/last-touch table) ------------------------

export function campaignKey(
  source: string | null,
  medium: string | null,
  campaign: string | null,
): string {
  return [source ?? "", medium ?? "", campaign ?? ""].join("|");
}

export function campaignLabel(
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

export type CampaignRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  trials: number;
  signups: number;
  activeSubs: number;
  mrr: number;
};

type TripleRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  n: number;
};

function mergeCampaignRows(
  trialsRows: TripleRow[],
  signupsRows: TripleRow[],
  subsRows: TripleRow[],
): CampaignRow[] {
  const map = new Map<string, CampaignRow>();
  const upsert = (
    source: string | null,
    medium: string | null,
    campaign: string | null,
  ): CampaignRow => {
    const key = campaignKey(source, medium, campaign);
    let row = map.get(key);
    if (!row) {
      row = { source, medium, campaign, trials: 0, signups: 0, activeSubs: 0, mrr: 0 };
      map.set(key, row);
    }
    return row;
  };
  for (const r of trialsRows) upsert(r.source, r.medium, r.campaign).trials += Number(r.n);
  for (const r of signupsRows) upsert(r.source, r.medium, r.campaign).signups += Number(r.n);
  for (const r of subsRows) {
    const row = upsert(r.source, r.medium, r.campaign);
    row.activeSubs += Number(r.n);
    row.mrr += Number(r.n) * MONTHLY_PRICE;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.mrr !== a.mrr) return b.mrr - a.mrr;
    return b.trials - a.trials;
  });
}

// ---- the loader ------------------------------------------------------------

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

export async function loadDashboard(f: AnalyticsFilters) {
  // Resolve the show filter to an id (avoids joins on the trial queries) and
  // provide the dropdown options.
  const showsList = await db
    .select({ id: shows.id, slug: shows.slug, title: shows.title })
    .from(shows)
    .where(isNull(shows.deletedAt))
    .orderBy(shows.title);
  const selectedShow =
    f.show !== "all" ? showsList.find((s) => s.slug === f.show) : undefined;
  const showId = selectedShow?.id;

  const statusSet: string[] | null =
    f.status === "active"
      ? ["active"]
      : f.status === "ag"
        ? [...ACCESS_GRANTING_STATUSES]
        : null; // all

  // Predicate builders ------------------------------------------------------
  const tSrc = trialSource(f.attribution);
  const tCmp =
    f.attribution === "first"
      ? trialSessions.attributionFirstCampaign
      : trialSessions.attributionLastCampaign;
  const trialConds = (from: Date, to: Date): SQL[] => {
    const c: (SQL | undefined)[] = [
      gte(trialSessions.startedAt, from),
      lte(trialSessions.startedAt, to),
      channelCond(tSrc, f.channel),
      campaignCond(tCmp, f.campaign),
      showId ? eq(trialSessions.showId, showId) : undefined,
    ];
    return c.filter((x): x is SQL => Boolean(x));
  };
  const uSrc =
    f.attribution === "first"
      ? users.attributionFirstSource
      : users.attributionLastSource;
  const uCmp =
    f.attribution === "first"
      ? users.attributionFirstCampaign
      : users.attributionLastCampaign;
  const userConds = (from: Date, to: Date): SQL[] => {
    const c: (SQL | undefined)[] = [
      gte(users.createdAt, from),
      lte(users.createdAt, to),
      channelCond(uSrc, f.channel),
      campaignCond(uCmp, f.campaign),
    ];
    return c.filter((x): x is SQL => Boolean(x));
  };
  const sSrc =
    f.attribution === "first"
      ? subscriptions.attributionFirstSource
      : subscriptions.attributionLastSource;
  const sCmp =
    f.attribution === "first"
      ? subscriptions.attributionFirstCampaign
      : subscriptions.attributionLastCampaign;
  // New subscriptions (createdAt) in a window, scoped by channel + campaign.
  const newSubConds = (from: Date, to: Date): SQL[] => {
    const c: (SQL | undefined)[] = [
      gte(subscriptions.createdAt, from),
      lte(subscriptions.createdAt, to),
      channelCond(sSrc, f.channel),
      campaignCond(sCmp, f.campaign),
    ];
    return c.filter((x): x is SQL => Boolean(x));
  };
  // Subscription-snapshot attribution filter (channel + campaign). Reused by the
  // active / serviced / status-mix / cancellation snapshot queries below.
  const subAttrConds: SQL[] = [
    channelCond(sSrc, f.channel),
    campaignCond(sCmp, f.campaign),
  ].filter((x): x is SQL => Boolean(x));

  const tT = trialTriple(f.attribution);
  const uT = userTriple(f.attribution);
  const sT = subTriple(f.attribution);

  // engagement / watch_progress show filter (join to shows)
  const wpShowCond = showId ? eq(seasons.showId, showId) : undefined;

  const muxTf = muxTimeframeForDays(
    (f.to.getTime() - f.from.getTime()) / DAY_MS,
  );

  const [
    // headline (current)
    signupsCur,
    trialFunnelCur,
    cohortCur,
    newSubsCur,
    // headline (previous window) — flow metrics only
    signupsPrev,
    previewsPrev,
    newSubsPrev,
    cohortPrev,
    // snapshots
    activeSubsRow,
    servicedSubsRow,
    statusMixRows,
    cancellationsRow,
    totalUsersRow,
    // time series
    seriesSignups,
    seriesTrials,
    seriesConversions,
    seriesNewSubs,
    // depth histogram
    depthRows,
    // engagement (subscribers)
    engagementRow,
    avgPctRow,
    topShowsRows,
    // campaign table
    campTrials,
    campSignups,
    campSubs,
    // dropdown options
    channelRows,
    campaignRows,
    // mux
    muxResult,
  ] = await Promise.all([
    // signups current
    db.select({ n: count() }).from(users).where(and(...userConds(f.from, f.to))),
    // trial funnel (row-based previews) current
    db
      .select({
        previews: count(),
        played: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.lastPositionSeconds} > 0)::int`,
        nearCap: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.lastPositionSeconds} >= 55)::int`,
        convertedPreviews: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.converted})::int`,
        avgDepth: sql<number>`COALESCE(AVG(${trialSessions.lastPositionSeconds}), 0)`,
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to))),
    // conversion cohort (distinct session) current — P6 fix
    db
      .select({
        started: countDistinct(trialSessions.sessionToken),
        converted: sql<number>`COUNT(DISTINCT ${trialSessions.sessionToken}) FILTER (WHERE ${trialSessions.converted})::int`,
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to))),
    // new subs current
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(and(...newSubConds(f.from, f.to))),
    // ---- previous window ----
    f.prevFrom && f.prevTo
      ? db
          .select({ n: count() })
          .from(users)
          .where(and(...userConds(f.prevFrom, f.prevTo)))
      : Promise.resolve([{ n: 0 }]),
    f.prevFrom && f.prevTo
      ? db
          .select({ n: count() })
          .from(trialSessions)
          .where(and(...trialConds(f.prevFrom, f.prevTo)))
      : Promise.resolve([{ n: 0 }]),
    f.prevFrom && f.prevTo
      ? db
          .select({ n: count() })
          .from(subscriptions)
          .where(and(...newSubConds(f.prevFrom, f.prevTo)))
      : Promise.resolve([{ n: 0 }]),
    f.prevFrom && f.prevTo
      ? db
          .select({
            converted: sql<number>`COUNT(DISTINCT ${trialSessions.sessionToken}) FILTER (WHERE ${trialSessions.converted})::int`,
          })
          .from(trialSessions)
          .where(and(...trialConds(f.prevFrom, f.prevTo)))
      : Promise.resolve([{ converted: 0 }]),
    // ---- snapshots ----
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "active"),
          ...subAttrConds,
        ),
      ),
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(
        and(
          sql`${subscriptions.status} IN ('active','trialing','past_due')`,
          ...subAttrConds,
        ),
      ),
    db
      .select({ status: subscriptions.status, n: count() })
      .from(subscriptions)
      .where(and(...subAttrConds) ?? sql`true`)
      .groupBy(subscriptions.status),
    db
      .select({ n: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "canceled"),
          gte(subscriptions.updatedAt, f.from),
          lte(subscriptions.updatedAt, f.to),
          ...subAttrConds,
        ),
      ),
    db.select({ n: count() }).from(users),
    // ---- time series ----
    db
      .select({ bucket: bucketExpr(users.createdAt, f.granularity), n: count() })
      .from(users)
      .where(and(...userConds(f.from, f.to)))
      .groupBy(bucketExpr(users.createdAt, f.granularity)),
    db
      .select({
        bucket: bucketExpr(trialSessions.startedAt, f.granularity),
        n: count(),
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to)))
      .groupBy(bucketExpr(trialSessions.startedAt, f.granularity)),
    db
      .select({
        bucket: bucketExpr(trialSessions.startedAt, f.granularity),
        n: sql<number>`COUNT(DISTINCT ${trialSessions.sessionToken}) FILTER (WHERE ${trialSessions.converted})::int`,
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to)))
      .groupBy(bucketExpr(trialSessions.startedAt, f.granularity)),
    db
      .select({
        bucket: bucketExpr(subscriptions.createdAt, f.granularity),
        n: count(),
      })
      .from(subscriptions)
      .where(and(...newSubConds(f.from, f.to)))
      .groupBy(bucketExpr(subscriptions.createdAt, f.granularity)),
    // ---- trial depth histogram (10s buckets, capped at 60) ----
    db
      .select({
        bucket: sql<number>`LEAST(${trialSessions.lastPositionSeconds} / 10, 6)::int`,
        n: count(),
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to)))
      .groupBy(sql`LEAST(${trialSessions.lastPositionSeconds} / 10, 6)`),
    // ---- engagement (subscribers) ----
    db
      .select({
        total: count(),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${watchProgress.completed})::int`,
        viewers: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
        seconds: sql<number>`COALESCE(SUM(${watchProgress.positionSeconds}), 0)::int`,
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(watchProgress.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(wpShowCond ?? sql`true`),
    db
      .select({
        pct: sql<number>`COALESCE(AVG(LEAST(${watchProgress.positionSeconds}::float / NULLIF(${episodes.durationSeconds}, 0), 1)) * 100, 0)`,
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(watchProgress.episodeId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(
        and(
          sql`${episodes.durationSeconds} IS NOT NULL AND ${episodes.durationSeconds} > 0`,
          wpShowCond,
        ),
      ),
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
      .where(wpShowCond ?? sql`true`)
      .groupBy(shows.id, shows.title, shows.slug)
      .orderBy(desc(sql`SUM(${watchProgress.positionSeconds})`))
      .limit(10),
    // ---- campaign table (chosen attribution model, in range) ----
    db
      .select({ source: tT.source, medium: tT.medium, campaign: tT.campaign, n: count() })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to)))
      .groupBy(tT.source, tT.medium, tT.campaign),
    db
      .select({ source: uT.source, medium: uT.medium, campaign: uT.campaign, n: count() })
      .from(users)
      .where(and(...userConds(f.from, f.to)))
      .groupBy(uT.source, uT.medium, uT.campaign),
    db
      .select({ source: sT.source, medium: sT.medium, campaign: sT.campaign, n: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(sT.source, sT.medium, sT.campaign),
    // ---- channel dropdown options (distinct sources, all-time) ----
    db
      .selectDistinct({ source: tSrc })
      .from(trialSessions)
      .where(sql`${tSrc} IS NOT NULL`),
    // ---- campaign dropdown options (distinct campaigns, all-time) ----
    db
      .selectDistinct({ campaign: tCmp })
      .from(trialSessions)
      .where(sql`${tCmp} IS NOT NULL`),
    // ---- mux ----
    getMuxData(muxTf.timeframe),
  ]);

  // Assemble -----------------------------------------------------------------
  const funnel = trialFunnelCur[0];
  const previews = Number(funnel.previews);
  const cohort = cohortCur[0];
  const started = Number(cohort.started);
  const converted = Number(cohort.converted);

  const series = fillSeries(f.from, f.to, f.granularity, {
    signups: new Map(seriesSignups.map((r) => [r.bucket, Number(r.n)])),
    trials: new Map(seriesTrials.map((r) => [r.bucket, Number(r.n)])),
    conversions: new Map(seriesConversions.map((r) => [r.bucket, Number(r.n)])),
    newSubs: new Map(seriesNewSubs.map((r) => [r.bucket, Number(r.n)])),
  });

  // Depth histogram: 0-9,10-19,...,50-59, 60(cap). bucket index 0..6.
  const depthMap = new Map(depthRows.map((r) => [Number(r.bucket), Number(r.n)]));
  const depthHistogram = Array.from({ length: 7 }, (_, i) => ({
    label: i < 6 ? `${i * 10}–${i * 10 + 9}s` : "60s",
    n: depthMap.get(i) ?? 0,
  }));

  const eng = engagementRow[0];
  const watchRows = Number(eng.total);
  const distinctViewers = Number(eng.viewers);
  const activeSubs = Number(activeSubsRow[0].n);

  const campaign = mergeCampaignRows(
    campTrials as TripleRow[],
    campSignups as TripleRow[],
    campSubs as TripleRow[],
  );

  const channelOptions = [
    DIRECT_BUCKET,
    ...channelRows
      .map((r) => r.source)
      .filter((s): s is string => Boolean(s))
      .sort(),
  ];

  const campaignOptions = [
    DIRECT_BUCKET,
    ...campaignRows
      .map((r) => r.campaign)
      .filter((s): s is string => Boolean(s))
      .sort(),
  ];

  const muxClampedNote = muxTf.clamped;

  return {
    filters: f,
    showsList,
    channelOptions,
    campaignOptions,
    // KPIs (flow metrics carry prev for deltas; snapshots do not)
    kpis: {
      signups: { value: Number(signupsCur[0].n), prev: Number(signupsPrev[0].n) },
      trialPreviews: { value: previews, prev: Number(previewsPrev[0].n) },
      conversions: { value: converted, prev: Number((cohortPrev[0] as { converted: number }).converted) },
      newSubs: { value: Number(newSubsCur[0].n), prev: Number(newSubsPrev[0].n) },
      activeSubs,
      servicedSubs: Number(servicedSubsRow[0].n),
      mrr: activeSubs * MONTHLY_PRICE,
      totalUsers: Number(totalUsersRow[0].n),
      cancellations: Number(cancellationsRow[0].n),
      conversionRate: started > 0 ? (converted / started) * 100 : 0,
      conversionStarted: started,
      conversionConverted: converted,
    },
    funnel: {
      previews,
      played: Number(funnel.played),
      nearCap: Number(funnel.nearCap),
      converted: Number(funnel.convertedPreviews),
      avgDepth: Math.round(Number(funnel.avgDepth)),
    },
    series,
    depthHistogram,
    engagement: {
      watchRows,
      completedRows: Number(eng.completed),
      distinctViewers,
      completionRate: watchRows > 0 ? (Number(eng.completed) / watchRows) * 100 : 0,
      avgPctWatched: Number(avgPctRow[0].pct),
      avgMinPerViewer:
        distinctViewers > 0
          ? Math.round(Number(eng.seconds) / distinctViewers / 60)
          : 0,
    },
    topShows: topShowsRows.map((s) => ({
      title: s.title,
      slug: s.slug,
      seconds: Number(s.seconds),
      viewers: Number(s.viewers),
      completed: Number(s.completed),
      plays: Number(s.plays),
    })),
    statusMix: statusMixRows.map((r) => ({ status: r.status, n: Number(r.n) })),
    campaign,
    mux: muxResult as MuxDataResult,
    muxTimeframe: muxTf.timeframe,
    muxClamped: muxClampedNote,
    statusScope: statusSet,
  };
}

// ---- episode-gated funnel (per gated show) ---------------------------------

export type EpisodeFunnel = {
  showSlug: string;
  showTitle: string;
  freeCount: number;
  memberCount: number;
  // Stages (counts of kind='episodes' sessions started in range, except
  // member stages which count linked users):
  started: number;        // 1. sessions that started a free episode
  wallHit: number;        // 2. signup_wall_at set OR furthest >= freeCount
  signedUp: number;       // 3. stage-2 sessions linked to a user
  memberWatchers: number; // 4. linked users with progress on any member ep
  paywallHit: number;     // 5. linked users who completed the last member ep
  subscribed: number;     // 6. sessions marked converted
  // Free-tier depth distribution: sessions whose furthest position reached
  // at least N, for N = 1..freeCount (cumulative, monotonically falling).
  depth: { label: string; n: number }[];
  // Per-member-episode reach among linked funnel users.
  memberEpisodes: { label: string; viewers: number; completed: number }[];
};

// One funnel per gated show (free_episodes + member_episodes > 0), scoped to
// the dashboard's date range via trial_sessions.started_at and respecting the
// show filter. Computed from our own tables — no consent blind spot (PostHog
// only sees consenting browsers; these rows exist for every viewer).
export async function loadEpisodeFunnels(
  f: AnalyticsFilters,
): Promise<EpisodeFunnel[]> {
  const gatedShows = await db
    .select({
      id: shows.id,
      slug: shows.slug,
      title: shows.title,
      freeEpisodes: shows.freeEpisodes,
      memberEpisodes: shows.memberEpisodes,
    })
    .from(shows)
    .where(
      and(
        isNull(shows.deletedAt),
        sql`${shows.freeEpisodes} + ${shows.memberEpisodes} > 0`,
      ),
    )
    .orderBy(shows.title);

  const scoped =
    f.show === "all"
      ? gatedShows
      : gatedShows.filter((s) => s.slug === f.show);
  if (scoped.length === 0) return [];

  const out: EpisodeFunnel[] = [];
  // Sequential per show is fine — gated shows are a handful at most, and
  // each iteration already parallelizes its own queries.
  for (const s of scoped) {
    const freeCount = Math.max(0, s.freeEpisodes);
    const memberCount = Math.max(0, s.memberEpisodes);

    const sessionConds: SQL[] = [
      eq(trialSessions.showId, s.id),
      eq(trialSessions.kind, "episodes"),
      gte(trialSessions.startedAt, f.from),
      lte(trialSessions.startedAt, f.to),
    ];
    // Users this funnel produced — sessions in range that got linked on
    // signup. Reused as a subquery by every member-tier stage.
    const linkedUsers = db
      .select({ userId: trialSessions.userId })
      .from(trialSessions)
      .where(and(...sessionConds, isNotNull(trialSessions.userId)));

    // Ready ordering with display fields — positions must match
    // lib/episode-access.ts (season number, then episode number).
    const orderedEps = await db
      .select({
        id: episodes.id,
        title: episodes.title,
        number: episodes.number,
        seasonNumber: seasons.number,
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(and(eq(seasons.showId, s.id), eq(episodes.status, "ready")))
      .orderBy(asc(seasons.number), asc(episodes.number));
    const memberEps = orderedEps.slice(freeCount, freeCount + memberCount);
    const memberEpIds = memberEps.map((e) => e.id);
    const lastMemberEp = memberEps.at(-1) ?? null;

    const [aggRows, depthRows, perEpisodeRows, memberWatchersRows, paywallRows] =
      await Promise.all([
        db
          .select({
            started: count(),
            wallHit: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.signupWallAt} IS NOT NULL OR ${trialSessions.furthestEpisodeNumber} >= ${freeCount})::int`,
            signedUp: sql<number>`COUNT(*) FILTER (WHERE (${trialSessions.signupWallAt} IS NOT NULL OR ${trialSessions.furthestEpisodeNumber} >= ${freeCount}) AND ${trialSessions.userId} IS NOT NULL)::int`,
            subscribed: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.converted})::int`,
          })
          .from(trialSessions)
          .where(and(...sessionConds)),
        db
          .select({
            furthest: trialSessions.furthestEpisodeNumber,
            n: count(),
          })
          .from(trialSessions)
          .where(and(...sessionConds))
          .groupBy(trialSessions.furthestEpisodeNumber),
        memberEpIds.length > 0
          ? db
              .select({
                episodeId: watchProgress.episodeId,
                viewers: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
                completed: sql<number>`COUNT(*) FILTER (WHERE ${watchProgress.completed})::int`,
              })
              .from(watchProgress)
              .where(
                and(
                  inArray(watchProgress.episodeId, memberEpIds),
                  inArray(watchProgress.userId, linkedUsers),
                ),
              )
              .groupBy(watchProgress.episodeId)
          : Promise.resolve(
              [] as { episodeId: string; viewers: number; completed: number }[],
            ),
        memberEpIds.length > 0
          ? db
              .select({
                n: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
              })
              .from(watchProgress)
              .where(
                and(
                  inArray(watchProgress.episodeId, memberEpIds),
                  inArray(watchProgress.userId, linkedUsers),
                ),
              )
          : Promise.resolve([{ n: 0 }] as { n: number }[]),
        lastMemberEp
          ? db
              .select({
                n: sql<number>`COUNT(DISTINCT ${watchProgress.userId})::int`,
              })
              .from(watchProgress)
              .where(
                and(
                  eq(watchProgress.episodeId, lastMemberEp.id),
                  eq(watchProgress.completed, true),
                  inArray(watchProgress.userId, linkedUsers),
                ),
              )
          : Promise.resolve([{ n: 0 }] as { n: number }[]),
      ]);

    // Cumulative depth: sessions whose furthest position >= N.
    const depthCounts = depthRows.map((r) => ({
      furthest: Number(r.furthest),
      n: Number(r.n),
    }));
    const depth = Array.from({ length: freeCount }, (_, i) => {
      const pos = i + 1;
      const reached = depthCounts.reduce(
        (acc, r) => (r.furthest >= pos ? acc + r.n : acc),
        0,
      );
      return { label: `E${pos}`, n: reached };
    });

    const perEpisode = new Map(
      perEpisodeRows.map((r) => [r.episodeId, r]),
    );
    const memberEpisodes = memberEps.map((e) => {
      const r = perEpisode.get(e.id);
      return {
        label: `S${e.seasonNumber}·E${e.number} ${e.title}`,
        viewers: r ? Number(r.viewers) : 0,
        completed: r ? Number(r.completed) : 0,
      };
    });

    const agg = aggRows[0];
    out.push({
      showSlug: s.slug,
      showTitle: s.title,
      freeCount,
      memberCount,
      started: Number(agg.started),
      wallHit: Number(agg.wallHit),
      signedUp: Number(agg.signedUp),
      memberWatchers: Number(memberWatchersRows[0]?.n ?? 0),
      paywallHit: Number(paywallRows[0]?.n ?? 0),
      subscribed: Number(agg.subscribed),
      depth,
      memberEpisodes,
    });
  }
  return out;
}
