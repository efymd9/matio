import "server-only";

// GRAIN NOTE (2026-06-09): autoplay-on-land changed what a trial_sessions
// row means. Rows (kind='preview' AND kind='episodes') now mint when a
// visible, autoplay-CAPABLE session lands on /watch — playback starts in
// the same moment — instead of on an explicit play press; autoplay-blocked
// sessions still mint on tap. Every metric counting rows or row-starts
// (Превью KPI, acquisition funnel stage 1, episode-funnel "started",
// conversion cohorts, campaign Sessions) is land-grain after that date.
// Third grain era: mount-mint (pre-2026-05-31) → click-mint → land-mint.
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
  ne,
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
// Ceiling on time-series bucket count. parseFilters coarsens the granularity
// until the range fits — without this, hourly × all-time generated tens of
// thousands of buckets and the fill loop's guard silently truncated the chart
// to its OLDEST 2000 buckets (an empty 2020 axis; real data never rendered).
const MAX_SERIES_BUCKETS = 750;
const BUCKET_APPROX_MS: Record<Granularity, number> = {
  hour: 60 * 60 * 1000,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS, // approximation only — used for the bucket-count cap
};
const COARSER_ORDER: Granularity[] = ["hour", "day", "week", "month"];

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
  // Resolve, then coerce to the bucket cap: an explicit fine granularity over
  // a huge range is coarsened step by step until it charts. The resolved
  // value is echoed in the Trend hint, so the override is visible.
  let granularity =
    granChoice === "auto" ? autoGranularity(from, to) : granChoice;
  while (
    granularity !== "month" &&
    (to.getTime() - from.getTime()) / BUCKET_APPROX_MS[granularity] >
      MAX_SERIES_BUCKETS
  ) {
    granularity = COARSER_ORDER[COARSER_ORDER.indexOf(granularity) + 1];
  }

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
  free: number;
  conversions: number;
  newSubs: number;
};

// Generate every bucket between from..to and merge the per-metric SQL rows so
// the chart always renders a continuous axis. parseFilters' granularity
// coercion (MAX_SERIES_BUCKETS) keeps any valid filter combination well under
// the loop guard — the guard is a pure backstop, not load-bearing.
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
      free: maps.free.get(key) ?? 0,
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
  walled: number;
  signups: number;
  activeSubs: number;
  mrr: number;
};

type TripleRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  n: number;
  // Sessions that reached a decision wall (preview paywall ≥55s, or the
  // free tier's sign-up wall). Only set on the trials rows.
  walled?: number;
  // Subs actually paying the recurring $38 now (status active/past_due, i.e.
  // excluding mid-$1-trial `trialing` rows). Only set on the subs rows; drives
  // MRR so a 3-day $1 trial that hasn't converted isn't credited as $38 MRR.
  paying?: number;
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
      row = { source, medium, campaign, trials: 0, walled: 0, signups: 0, activeSubs: 0, mrr: 0 };
      map.set(key, row);
    }
    return row;
  };
  for (const r of trialsRows) {
    const row = upsert(r.source, r.medium, r.campaign);
    row.trials += Number(r.n);
    row.walled += Number(r.walled ?? 0);
  }
  for (const r of signupsRows) upsert(r.source, r.medium, r.campaign).signups += Number(r.n);
  for (const r of subsRows) {
    const row = upsert(r.source, r.medium, r.campaign);
    // "Subs" counts every access-granting sub created in range (incl. mid-trial
    // `trialing` — a $1 trial-start is still a real subscription). MRR counts
    // only the ones actually paying the recurring $38 (active/past_due), so a
    // trial that hasn't reached its day-3 charge contributes $0 MRR, not $38.
    row.activeSubs += Number(r.n);
    row.mrr += Number(r.paying ?? r.n) * MONTHLY_PRICE;
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.mrr !== a.mrr) return b.mrr - a.mrr;
    return b.trials - a.trials;
  });
}

// ---- the loader ------------------------------------------------------------

// 1-based position of each show's LAST free ready episode in
// (season number, episode number) order — the positional wall threshold: a
// viewer whose furthest_episode_number reached it has seen everything the
// free tier offers and is standing at the wall. Mirror of the derivation
// inside loadEpisodeFunnels (keep the two in sync). Shows with no free
// episodes are omitted — for them only the signup_wall_at stamp counts.
async function loadLastFreePositions(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      showId: seasons.showId,
      access: episodes.access,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(episodes.status, "ready"))
    .orderBy(asc(seasons.showId), asc(seasons.number), asc(episodes.number));

  const out = new Map<string, number>();
  let currentShow: string | null = null;
  let pos = 0;
  for (const r of rows) {
    if (r.showId !== currentShow) {
      currentShow = r.showId;
      pos = 0;
    }
    pos += 1;
    if (r.access === "free") out.set(r.showId, pos);
  }
  return out;
}

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

  // Applied to the status-mix donut below (the only chart the "Subs" filter
  // scopes — the active/serviced KPI snapshots are definitionally fixed).
  const statusSet =
    f.status === "active"
      ? (["active"] as const)
      : f.status === "ag"
        ? ACCESS_GRANTING_STATUSES
        : null; // all

  // Predicate builders ------------------------------------------------------
  const tSrc = trialSource(f.attribution);
  const tCmp =
    f.attribution === "first"
      ? trialSessions.attributionFirstCampaign
      : trialSessions.attributionLastCampaign;
  // kind: 'preview' = 60s-trailer rows only, 'episodes' = free-tier rows
  // only, undefined = all anonymous sessions. The preview funnel / depth
  // metrics MUST scope to 'preview' — free-tier rows legitimately exceed the
  // 60s cap and were silently inflating every trial metric.
  const trialConds = (
    from: Date,
    to: Date,
    kind?: "preview" | "episodes",
  ): SQL[] => {
    const c: (SQL | undefined)[] = [
      kind ? eq(trialSessions.kind, kind) : undefined,
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
      // Pre-purchase accounts only. Pay-first guest accounts are created AT
      // purchase (claimGuestCheckout), so without this filter the Signups
      // KPI / trend / campaign column would just echo "New subs" for paid
      // traffic and the signups→subs gap would stop measuring checkout
      // drop-off.
      eq(users.signupOrigin, "clerk_signup"),
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

  // Positional wall thresholds for the campaign table's "walled" count: the
  // 1-based position of each show's LAST free ready episode in
  // (season, episode) order — the same derivation loadEpisodeFunnels uses
  // (keep them in sync). Needed because the signup_wall_at stamp is
  // member-tier-only: a show with no member episodes (free → straight to the
  // subscription paywall, e.g. thunder-lady post pay-first) never stamps, so
  // a stamp-only count would read 0% for its campaigns regardless of real
  // engagement. Episode tiers are config, not range data — one cheap query.
  const wallPosByShow = await loadLastFreePositions();
  const walledCond = sql.join(
    [
      sql`(${trialSessions.kind} = 'preview' AND ${trialSessions.lastPositionSeconds} >= 55)`,
      sql`(${trialSessions.kind} = 'episodes' AND ${trialSessions.signupWallAt} IS NOT NULL)`,
      ...[...wallPosByShow.entries()].map(
        ([wShowId, lastFreePos]) =>
          sql`(${trialSessions.kind} = 'episodes' AND ${trialSessions.showId} = ${wShowId} AND ${trialSessions.furthestEpisodeNumber} >= ${lastFreePos})`,
      ),
    ],
    sql` OR `,
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
    cancellationsPrevRow,
    // time series
    seriesSignups,
    seriesTrials,
    seriesFree,
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
  ] = await Promise.all([
    // signups current
    db.select({ n: count() }).from(users).where(and(...userConds(f.from, f.to))),
    // trial funnel (row-based 60s previews) current. kind='preview' only —
    // free-tier rows aren't 60s-capped and would flood every step. avgDepth
    // LEASTs at 60: ~10% of preview rows exceed the cap (seek / buffered
    // playback past token expiry) and were inflating the average.
    db
      .select({
        previews: count(),
        played: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.lastPositionSeconds} > 0)::int`,
        nearCap: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.lastPositionSeconds} >= 55)::int`,
        convertedPreviews: sql<number>`COUNT(*) FILTER (WHERE ${trialSessions.converted})::int`,
        avgDepth: sql<number>`COALESCE(AVG(LEAST(${trialSessions.lastPositionSeconds}, 60)), 0)`,
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to, "preview"))),
    // conversion cohort (distinct session) current — P6 fix. All kinds:
    // free-tier sessions convert through the signup wall, previews through
    // the paywall; both are real session→paid conversions.
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
          .where(and(...trialConds(f.prevFrom, f.prevTo, "preview")))
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
    // status mix donut — the one place the "Subs" filter scopes.
    db
      .select({ status: subscriptions.status, n: count() })
      .from(subscriptions)
      .where(
        and(
          ...(statusSet
            ? [inArray(subscriptions.status, [...statusSet])]
            : []),
          ...subAttrConds,
        ) ?? sql`true`,
      )
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
    f.prevFrom && f.prevTo
      ? db
          .select({ n: count() })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.status, "canceled"),
              gte(subscriptions.updatedAt, f.prevFrom),
              lte(subscriptions.updatedAt, f.prevTo),
              ...subAttrConds,
            ),
          )
      : Promise.resolve([{ n: 0 }]),
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
      .where(and(...trialConds(f.from, f.to, "preview")))
      .groupBy(bucketExpr(trialSessions.startedAt, f.granularity)),
    db
      .select({
        bucket: bucketExpr(trialSessions.startedAt, f.granularity),
        n: count(),
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to, "episodes")))
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
    // ---- trial depth histogram (10s buckets, capped at 60; previews only) ----
    db
      .select({
        bucket: sql<number>`LEAST(${trialSessions.lastPositionSeconds} / 10, 6)::int`,
        n: count(),
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to, "preview")))
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
    // Sessions of BOTH kinds (top-of-funnel volume) + the wall-reach count:
    // preview paywall (≥55s), the free tier's sign-up wall stamp, or —
    // positional fallback — having reached the show's last free episode
    // (walledCond above). The per-campaign engagement signal that works
    // while conversions are ~zero.
    db
      .select({
        source: tT.source,
        medium: tT.medium,
        campaign: tT.campaign,
        n: count(),
        walled: sql<number>`COUNT(*) FILTER (WHERE ${walledCond})::int`,
      })
      .from(trialSessions)
      .where(and(...trialConds(f.from, f.to)))
      .groupBy(tT.source, tT.medium, tT.campaign),
    db
      .select({ source: uT.source, medium: uT.medium, campaign: uT.campaign, n: count() })
      .from(users)
      .where(and(...userConds(f.from, f.to)))
      .groupBy(uT.source, uT.medium, uT.campaign),
    // New subs per campaign — created in range, still access-granting, and
    // honoring the channel/campaign filter. Same flow grain as the Sessions /
    // Signups columns (the old all-time active snapshot made the per-row
    // Sess→sub ratio divide two different populations). `paying` excludes
    // mid-$1-trial rows so the campaign MRR isn't inflated by trials that
    // haven't reached their day-3 $38 charge (see mergeCampaignRows).
    db
      .select({
        source: sT.source,
        medium: sT.medium,
        campaign: sT.campaign,
        n: count(),
        paying: sql<number>`COUNT(*) FILTER (WHERE ${subscriptions.status} IN ('active','past_due'))::int`,
      })
      .from(subscriptions)
      .where(
        and(
          inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
          ...newSubConds(f.from, f.to),
        ),
      )
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
    free: new Map(seriesFree.map((r) => [r.bucket, Number(r.n)])),
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

  // Guest-checkout account creations in range (signup_origin='guest_checkout').
  // Deliberately EXCLUDED from the clerk_signup-only `signups` KPI (a guest
  // account is created AT purchase, so counting it as a "signup" would
  // double-read New subs and break the signup→sub funnel) — but pay-first
  // buyers were otherwise invisible on the dashboard. Counted here and shown
  // broken out on the New subs tile. Cheap indexed counts, kept out of the big
  // Promise.all to avoid threading through its positional destructuring.
  const guestSignupConds = (from: Date, to: Date): SQL[] =>
    [
      gte(users.createdAt, from),
      lte(users.createdAt, to),
      eq(users.signupOrigin, "guest_checkout"),
      channelCond(uSrc, f.channel),
      campaignCond(uCmp, f.campaign),
    ].filter((x): x is SQL => Boolean(x));
  const [guestSignupsCur, guestSignupsPrev] = await Promise.all([
    db
      .select({ n: count() })
      .from(users)
      .where(and(...guestSignupConds(f.from, f.to))),
    f.prevFrom && f.prevTo
      ? db
          .select({ n: count() })
          .from(users)
          .where(and(...guestSignupConds(f.prevFrom, f.prevTo)))
      : Promise.resolve([{ n: 0 }]),
  ]);

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
      guestSignups: {
        value: Number(guestSignupsCur[0].n),
        prev: Number(guestSignupsPrev[0].n),
      },
      activeSubs,
      servicedSubs: Number(servicedSubsRow[0].n),
      mrr: activeSubs * MONTHLY_PRICE,
      cancellations: {
        value: Number(cancellationsRow[0].n),
        prev: Number(cancellationsPrevRow[0].n),
      },
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

// One funnel per tier-gated show (≥1 ready episode below the subscriber
// tier), scoped to the dashboard's date range via trial_sessions.started_at
// and respecting the
// show filter. Computed from our own tables — no consent blind spot (PostHog
// only sees consenting browsers; these rows exist for every viewer).
export async function loadEpisodeFunnels(
  f: AnalyticsFilters,
): Promise<EpisodeFunnel[]> {
  // Tier-gated shows = at least one READY episode below the subscriber
  // tier (set-query mirror of showHasTierGating).
  const gatedShowIds = db
    .selectDistinct({ showId: seasons.showId })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(eq(episodes.status, "ready"), ne(episodes.access, "subscriber")),
    );
  const gatedShows = await db
    .select({ id: shows.id, slug: shows.slug, title: shows.title })
    .from(shows)
    .where(and(isNull(shows.deletedAt), inArray(shows.id, gatedShowIds)))
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
        access: episodes.access,
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(and(eq(seasons.showId, s.id), eq(episodes.status, "ready")))
      .orderBy(asc(seasons.number), asc(episodes.number));

    // Sets come from each episode's own access value; positions stay
    // 1-based in the ready ordering (the funnel depth metric is
    // positional). Free sets may be non-contiguous — the wall threshold is
    // the LAST free episode's position: a viewer who started it has seen
    // everything the free tier offers.
    const freePositions = orderedEps
      .map((e, i) => (e.access === "free" ? i + 1 : 0))
      .filter((p) => p > 0);
    const freeCount = freePositions.length;
    const lastFreePos =
      freePositions.length > 0 ? freePositions[freePositions.length - 1] : 0;
    const memberEps = orderedEps.filter((e) => e.access === "member");
    const memberCount = memberEps.length;
    const memberEpIds = memberEps.map((e) => e.id);
    const lastMemberEp = memberEps.at(-1) ?? null;

    // Wall-hit: explicit stamp, or positional depth reaching the last free
    // episode. With an empty free set there is no positional threshold —
    // only the stamp counts.
    const wallCond =
      lastFreePos > 0
        ? sql`(${trialSessions.signupWallAt} IS NOT NULL OR ${trialSessions.furthestEpisodeNumber} >= ${lastFreePos})`
        : sql`${trialSessions.signupWallAt} IS NOT NULL`;

    const [aggRows, depthRows, perEpisodeRows, memberWatchersRows, paywallRows] =
      await Promise.all([
        db
          .select({
            started: count(),
            wallHit: sql<number>`COUNT(*) FILTER (WHERE ${wallCond})::int`,
            signedUp: sql<number>`COUNT(*) FILTER (WHERE ${wallCond} AND ${trialSessions.userId} IS NOT NULL)::int`,
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
    const depth = Array.from({ length: lastFreePos }, (_, i) => {
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
