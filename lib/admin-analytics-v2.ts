import "server-only";

import { cache } from "react";
import {
  and,
  asc,
  count,
  countDistinct,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  min,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  episodes,
  seasons,
  shows,
  users,
  visitorDays,
  visitors,
  watchDays,
  watchProgress,
  watchSegments,
} from "@/db/schema";
import { WATCH_SEGMENT_BUCKET_SECONDS } from "@/lib/watch-segments";

// ---------------------------------------------------------------------------
// Data layer for the spec'd /admin/analytics page (free-mode dashboard,
// 2026-07 redesign): "does the content hook people enough that they come
// back?". Everything here reads the first-party ledgers (visitors /
// visitor_days / watch_days / watch_segments) plus watch_progress + users.
// The legacy paid-mode data layer stays in lib/admin-analytics.ts.
//
// Metric definitions (the spec's dictionary):
//   Визит            — unique anonymous visitor per UTC day (visitor_days)
//   Живая аудитория  — distinct watchers over a rolling 7 (or 14) days
//   Потерянный       — 7 straight days without a single watch
//   Глубокий досмотр — ≥80% of the episode's duration (max playhead)
//   Completion       — finished the episode (completed flag, or ≥95% for
//                      rows that predate the flag's ended-only semantics)
//   Release retention— % of ep-N finishers who started ep N+1 within
//                      7 days of its release
//   Источник         — first-visit utm_source, else referrer host, else direct
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEEP_WATCH_FRACTION = 0.8;
export const FINISH_FRACTION = 0.95;
export const REWATCH_FRACTION = 1.3;
export const RELEASE_RETENTION_WINDOW_DAYS = 7;
// Milestone cut points for the funnel's depth stages.
export const DEPTH_MILESTONES = [0.25, 0.5, 0.8] as const;

export { SOURCE_BUCKETS, type SourceBucket } from "@/lib/analytics-spec-shared";
import { SOURCE_BUCKETS, type SourceBucket } from "@/lib/analytics-spec-shared";

// --- Filters ---------------------------------------------------------------

export type SpecRangePreset = "7d" | "30d" | "90d" | "custom";

export type SpecFilters = {
  preset: SpecRangePreset;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** "all" | SourceBucket */
  source: string;
  /** "all" | ISO-3166-1 alpha-2 */
  country: string;
  /** Liveness window for the pulse chart (spec: 7 default, 14 optional). */
  window: 7 | 14;
  /** Selected episode for the retention-curve drill-down. */
  episode: string | null;
  customFrom: string | null;
  customTo: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseYmd(v: string | undefined | null): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// URL searchParams → validated filters. Unknown values fall back to safe
// defaults so a hand-edited URL can never throw (same contract as the
// legacy parseFilters).
export function parseSpecFilters(sp: RawParams, now: Date): SpecFilters {
  const rangeRaw = one(sp.range);
  const customFrom = one(sp.from) ?? null;
  const customTo = one(sp.to) ?? null;

  let preset: SpecRangePreset;
  let from: Date;
  let to: Date = now;
  if (rangeRaw === "custom" && parseYmd(customFrom)) {
    preset = "custom";
    from = parseYmd(customFrom)!;
    const toParsed = parseYmd(customTo);
    to = toParsed ? new Date(toParsed.getTime() + DAY_MS - 1) : now;
    if (to < from) to = new Date(from.getTime() + DAY_MS - 1);
  } else {
    preset = rangeRaw === "7d" || rangeRaw === "90d" ? rangeRaw : "30d";
    from = new Date(
      now.getTime() - (preset === "7d" ? 7 : preset === "90d" ? 90 : 30) * DAY_MS,
    );
  }

  const len = to.getTime() - from.getTime();

  const sourceRaw = one(sp.src);
  const source = (SOURCE_BUCKETS as readonly string[]).includes(sourceRaw ?? "")
    ? (sourceRaw as string)
    : "all";

  const countryRaw = (one(sp.geo) ?? "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : "all";

  const epRaw = one(sp.ep);
  const episode = epRaw && UUID_RE.test(epRaw) ? epRaw : null;

  return {
    preset,
    from,
    to,
    prevFrom: new Date(from.getTime() - len),
    prevTo: from,
    source,
    country,
    window: one(sp.w) === "14" ? 14 : 7,
    episode,
    customFrom: preset === "custom" ? customFrom : null,
    customTo: preset === "custom" ? customTo : null,
  };
}

// --- Shared SQL fragments --------------------------------------------------

// First-visit traffic source, bucketed to the matrix rows. utm_source is
// stored already normalized by normalizeUtmSource (facebook/meta → fb,
// instagram → ig) — the extra aliases are defensive for hand-crafted URLs
// that bypassed the beacon's normalization. Referrer fallback per the
// spec's dictionary; our own domain (locale-switch reloads) reads direct.
const sourceBucketSql = sql<string>`CASE
  WHEN ${visitors.utmSource} = 'tiktok' THEN 'tiktok'
  WHEN ${visitors.utmSource} IN ('ig', 'instagram') THEN 'ig'
  WHEN ${visitors.utmSource} IN ('fb', 'facebook', 'meta') THEN 'fb'
  WHEN ${visitors.utmSource} IS NOT NULL THEN 'other'
  WHEN ${visitors.referrer} ILIKE '%tiktok.%' THEN 'tiktok'
  WHEN ${visitors.referrer} ILIKE '%instagram.%' THEN 'ig'
  WHEN ${visitors.referrer} ILIKE '%facebook.%' OR ${visitors.referrer} ILIKE '%fb.com%' OR ${visitors.referrer} ILIKE '%fb.watch%' THEN 'fb'
  WHEN ${visitors.referrer} ILIKE '%matio.tv%' THEN 'direct'
  WHEN ${visitors.referrer} IS NULL OR ${visitors.referrer} = '' THEN 'direct'
  ELSE 'other'
END`;

// Earliest linked visitor per user — the user-level source/country lens.
// A user can legitimately own several visitor rows (each browser they
// signed in on); the FIRST one is the acquisition channel.
function userVisitorSq() {
  return db
    .selectDistinctOn([visitors.userId], {
      userId: visitors.userId,
      source: sourceBucketSql.as("uv_source"),
      country: visitors.country,
    })
    .from(visitors)
    .where(isNotNull(visitors.userId))
    .orderBy(visitors.userId, asc(visitors.firstSeenAt))
    .as("uv");
}

// "Finished the episode": the ended-handler flag, or ≥95% of duration for
// rows that predate it / saved mid-credits. Duration-less episodes fall
// back to the flag alone.
function finishedSql(
  wp: { completed: AnyColumn | SQL; maxPositionSeconds: AnyColumn | SQL },
  durationExpr: SQL<number | null>,
): SQL<boolean> {
  return sql<boolean>`(${wp.completed} OR (COALESCE(${durationExpr}, 0) > 0 AND ${wp.maxPositionSeconds} >= ${FINISH_FRACTION}::float8 * ${durationExpr}))`;
}

// "Deep watch": ≥80% of the episode's duration — the North-Star predicate.
// Call sites join `episodes` for the duration.
function deepWatchSql(maxPosition: AnyColumn | SQL): SQL<boolean> {
  return sql<boolean>`(COALESCE(${episodes.durationSeconds}, 0) > 0 AND ${maxPosition} >= ${DEEP_WATCH_FRACTION}::float8 * ${episodes.durationSeconds})`;
}

const newUserWhere = (from: Date, to: Date) =>
  and(
    gte(users.createdAt, from),
    lte(users.createdAt, to),
    eq(users.signupOrigin, "clerk_signup"),
  );

// --- KPI row ---------------------------------------------------------------

export type SpecKpis = {
  visits: { current: number; previous: number };
  registrations: {
    current: number;
    previous: number;
    /** registrations / visits, percent (0–100), null when visits = 0 */
    conversion: number | null;
  };
  northStar: {
    /** % of new users whose FIRST episode reached ≥80%, null when no new users */
    current: number | null;
    previous: number | null;
    newUsers: number;
    deepWatchers: number;
  };
  releaseRetention: {
    /** % of ep-N finishers back on ep N+1 within the window, for next-eps
     * released in the period. null = no releases in the period. */
    current: number | null;
    previous: number | null;
    finishers: number;
    returned: number;
  };
};

async function countVisits(f: SpecFilters, from: Date, to: Date) {
  const conds = [gte(visitorDays.day, ymd(from)), lte(visitorDays.day, ymd(to))];
  if (f.source !== "all") conds.push(eq(sourceBucketSql, f.source));
  if (f.country !== "all") conds.push(eq(visitors.country, f.country));
  const [row] = await db
    .select({ n: countDistinct(visitorDays.aid) })
    .from(visitorDays)
    .innerJoin(visitors, eq(visitors.aid, visitorDays.aid))
    .where(and(...conds));
  return row?.n ?? 0;
}

async function countRegistrations(f: SpecFilters, from: Date, to: Date) {
  const uv = userVisitorSq();
  const conds = [newUserWhere(from, to)];
  if (f.country !== "all") conds.push(eq(users.country, f.country));
  if (f.source !== "all") conds.push(eq(uv.source, f.source));
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .leftJoin(uv, eq(uv.userId, users.id))
    .where(and(...conds));
  return row?.n ?? 0;
}

// First episode each user ever started (by first_watched_at).
function firstEpisodeSq() {
  return db
    .selectDistinctOn([watchProgress.userId], {
      userId: watchProgress.userId,
      episodeId: watchProgress.episodeId,
      maxPositionSeconds: watchProgress.maxPositionSeconds,
      completed: watchProgress.completed,
      firstWatchedAt: watchProgress.firstWatchedAt,
    })
    .from(watchProgress)
    .orderBy(watchProgress.userId, asc(watchProgress.firstWatchedAt))
    .as("fe");
}

async function northStarCounts(f: SpecFilters, from: Date, to: Date) {
  const uv = userVisitorSq();
  const fe = firstEpisodeSq();
  const conds = [newUserWhere(from, to)];
  if (f.country !== "all") conds.push(eq(users.country, f.country));
  if (f.source !== "all") conds.push(eq(uv.source, f.source));
  const [row] = await db
    .select({
      newUsers: count(),
      deep: sql<number>`COUNT(*) FILTER (WHERE ${deepWatchSql(fe.maxPositionSeconds)})`.mapWith(
        Number,
      ),
    })
    .from(users)
    .leftJoin(uv, eq(uv.userId, users.id))
    .leftJoin(fe, eq(fe.userId, users.id))
    .leftJoin(episodes, eq(episodes.id, fe.episodeId))
    .where(and(...conds));
  return { newUsers: row?.newUsers ?? 0, deep: row?.deep ?? 0 };
}

export async function loadSpecKpis(f: SpecFilters): Promise<SpecKpis> {
  const [
    visitsCur,
    visitsPrev,
    regsCur,
    regsPrev,
    nsCur,
    nsPrev,
    releaseStats,
  ] = await Promise.all([
    countVisits(f, f.from, f.to),
    countVisits(f, f.prevFrom, f.prevTo),
    countRegistrations(f, f.from, f.to),
    countRegistrations(f, f.prevFrom, f.prevTo),
    northStarCounts(f, f.from, f.to),
    northStarCounts(f, f.prevFrom, f.prevTo),
    loadReleaseStats(),
  ]);

  const rrWindow = (from: Date, to: Date) => {
    let finishers = 0;
    let returned = 0;
    for (const pair of releaseStats.pairs) {
      if (!pair.release || pair.release < from || pair.release > to) continue;
      for (const cell of pair.cells) {
        if (f.country !== "all" && cell.country !== f.country) continue;
        if (f.source !== "all" && cell.source !== f.source) continue;
        finishers += cell.finishers;
        returned += cell.returned;
      }
    }
    return {
      finishers,
      returned,
      pct: finishers > 0 ? (returned / finishers) * 100 : null,
    };
  };
  const rrCur = rrWindow(f.from, f.to);
  const rrPrev = rrWindow(f.prevFrom, f.prevTo);

  return {
    visits: { current: visitsCur, previous: visitsPrev },
    registrations: {
      current: regsCur,
      previous: regsPrev,
      conversion: visitsCur > 0 ? (regsCur / visitsCur) * 100 : null,
    },
    northStar: {
      current: nsCur.newUsers > 0 ? (nsCur.deep / nsCur.newUsers) * 100 : null,
      previous:
        nsPrev.newUsers > 0 ? (nsPrev.deep / nsPrev.newUsers) * 100 : null,
      newUsers: nsCur.newUsers,
      deepWatchers: nsCur.deep,
    },
    releaseRetention: {
      current: rrCur.pct,
      previous: rrPrev.pct,
      finishers: rrCur.finishers,
      returned: rrCur.returned,
    },
  };
}

// --- Block 2: pulse (living audience) --------------------------------------

export type PulsePoint = {
  day: string; // YYYY-MM-DD
  wau: number;
  newUsers: number;
  returning: number;
  lost: number;
};

export type PulseData = {
  points: PulsePoint[];
  windowDays: 7 | 14;
  /** net for the last day of the range and for its last 7 days */
  netToday: { new: number; lost: number };
  netWeek: { new: number; lost: number };
  releases: { day: string; showTitle: string; episodeNumber: number }[];
};

// Restrict watch_days to users matching the source/country lens. Returns
// null when no filter is active (skip the subquery entirely).
function filteredUserIdsSq(f: SpecFilters) {
  if (f.source === "all" && f.country === "all") return null;
  const uv = userVisitorSq();
  const conds: SQL[] = [];
  if (f.country !== "all") conds.push(eq(users.country, f.country));
  if (f.source !== "all") conds.push(eq(uv.source, f.source));
  return db
    .select({ id: users.id })
    .from(users)
    .leftJoin(uv, eq(uv.userId, users.id))
    .where(and(...conds));
}

export async function loadPulse(f: SpecFilters): Promise<PulseData> {
  // Day-grain series; clamp pathological custom ranges to a year of points.
  const start =
    (f.to.getTime() - f.from.getTime()) / DAY_MS > 366
      ? new Date(f.to.getTime() - 366 * DAY_MS)
      : f.from;
  const days: string[] = [];
  for (let t = start.getTime(); t <= f.to.getTime(); t += DAY_MS) {
    days.push(ymd(new Date(t)));
  }
  const userFilter = filteredUserIdsSq(f);
  const wdWhere = userFilter ? inArray(watchDays.userId, userFilter) : undefined;

  // Rolling window: distinct watchers over the trailing N days, one point
  // per day. generate_series keeps zero-activity days on the axis.
  const windowDays = f.window;
  // No alias on watch_days — the interpolated column/condition fragments
  // render the fully-qualified table name, which stops resolving the
  // moment an SQL alias shadows it.
  const userFilterSql = userFilter ? sql` AND ${wdWhere}` : sql``;
  // generate_series over dates yields TIMESTAMPS — cast back to date so
  // date-minus-integer arithmetic and the text day key both work.
  const wauRows = (await db.execute(sql`
    SELECT gs.d::date::text AS day, COUNT(DISTINCT ${watchDays.userId})::int AS wau
    FROM generate_series(${days[0]}::date, ${days[days.length - 1]}::date, '1 day') AS gs(d)
    LEFT JOIN ${watchDays}
      ON ${watchDays.day} > gs.d::date - ${windowDays}::int AND ${watchDays.day} <= gs.d::date${userFilterSql}
    GROUP BY gs.d
    ORDER BY gs.d
  `)) as unknown as { day: string; wau: number }[];

  // First / last activity day per user (all-time) + per-day actives. The
  // whole table is small; the daily balance is computed in JS.
  const [firstDays, lastDays, actives] = await Promise.all([
    db
      .select({ userId: watchDays.userId, day: min(watchDays.day) })
      .from(watchDays)
      .where(wdWhere)
      .groupBy(watchDays.userId),
    db
      .select({ userId: watchDays.userId, day: sql<string>`MAX(${watchDays.day})` })
      .from(watchDays)
      .where(wdWhere)
      .groupBy(watchDays.userId),
    db
      .select({ day: watchDays.day, userId: watchDays.userId })
      .from(watchDays)
      .where(
        and(
          gte(watchDays.day, days[0]),
          lte(watchDays.day, days[days.length - 1]),
          wdWhere,
        ),
      ),
  ]);

  const firstByUser = new Map(firstDays.map((r) => [r.userId, r.day]));
  const newPerDay = new Map<string, number>();
  for (const r of firstDays) {
    if (r.day) newPerDay.set(r.day, (newPerDay.get(r.day) ?? 0) + 1);
  }
  // A user is "lost" on day D when their last activity was exactly D-7 —
  // they crossed the 7-silent-days line that day (and haven't returned
  // since; a later return retroactively un-loses them, which is the
  // desired live semantics).
  const lostPerDay = new Map<string, number>();
  const today = ymd(new Date());
  for (const r of lastDays) {
    if (!r.day) continue;
    const lostDay = ymd(new Date(new Date(`${r.day}T00:00:00Z`).getTime() + 7 * DAY_MS));
    if (lostDay <= today) {
      lostPerDay.set(lostDay, (lostPerDay.get(lostDay) ?? 0) + 1);
    }
  }
  const activePerDay = new Map<string, Set<string>>();
  for (const r of actives) {
    let set = activePerDay.get(r.day);
    if (!set) activePerDay.set(r.day, (set = new Set()));
    set.add(r.userId);
  }

  const wauByDay = new Map(wauRows.map((r) => [r.day, Number(r.wau)]));
  const points: PulsePoint[] = days.map((day) => {
    const active = activePerDay.get(day);
    let newUsers = 0;
    if (active) {
      for (const u of active) if (firstByUser.get(u) === day) newUsers += 1;
    }
    return {
      day,
      wau: wauByDay.get(day) ?? 0,
      newUsers,
      returning: (active?.size ?? 0) - newUsers,
      lost: lostPerDay.get(day) ?? 0,
    };
  });

  const last = points[points.length - 1];
  const lastWeek = points.slice(-7);
  const releases = (await loadReleaseStats()).pairs
    .filter((p) => p.release && ymd(p.release) >= days[0] && ymd(p.release) <= days[days.length - 1])
    .map((p) => ({
      day: ymd(p.release!),
      showTitle: p.showTitle,
      episodeNumber: p.nextEpisodeNumber,
    }));

  return {
    points,
    windowDays,
    netToday: { new: last?.newUsers ?? 0, lost: last?.lost ?? 0 },
    netWeek: {
      new: lastWeek.reduce((a, p) => a + p.newUsers, 0),
      lost: lastWeek.reduce((a, p) => a + p.lost, 0),
    },
    releases,
  };
}

// --- Block 3: full funnel --------------------------------------------------

export type SpecFunnel = {
  /** cohort = visitors first seen in the period (site entry) */
  cohort: number;
  landedHome: number;
  showViewed: number;
  wallSeen: number;
  registered: number;
  started: number;
  d25: number;
  d50: number;
  d80: number;
  d100: number;
};

export async function loadSpecFunnel(f: SpecFilters): Promise<SpecFunnel> {
  const vd = db
    .select({
      aid: visitorDays.aid,
      home: sql<boolean>`bool_or(${visitorDays.landedHome})`.as("vd_home"),
      show: sql<boolean>`bool_or(${visitorDays.showViewed})`.as("vd_show"),
      wall: sql<boolean>`bool_or(${visitorDays.wallSeen})`.as("vd_wall"),
    })
    .from(visitorDays)
    .groupBy(visitorDays.aid)
    .as("vd");
  const fe = firstEpisodeSq();

  const conds = [
    gte(visitors.firstSeenAt, f.from),
    lte(visitors.firstSeenAt, f.to),
  ];
  if (f.source !== "all") conds.push(eq(sourceBucketSql, f.source));
  if (f.country !== "all") conds.push(eq(visitors.country, f.country));

  // "Registered" = the linked account was CREATED after this visitor first
  // appeared (small grace for clock skew) — an old account signing in on a
  // fresh browser links for other analyses but must not read as a funnel
  // conversion. Later stages nest inside registered via the users join.
  const registered = sql`${users.id} IS NOT NULL`;
  const started = sql`${registered} AND ${fe.userId} IS NOT NULL`;
  const depth = (fraction: number) =>
    sql<number>`COUNT(*) FILTER (WHERE ${started} AND COALESCE(${episodes.durationSeconds}, 0) > 0 AND ${fe.maxPositionSeconds} >= ${fraction}::float8 * ${episodes.durationSeconds})`.mapWith(
      Number,
    );

  const [row] = await db
    .select({
      cohort: count(),
      landedHome: sql<number>`COUNT(*) FILTER (WHERE ${vd.home})`.mapWith(Number),
      showViewed: sql<number>`COUNT(*) FILTER (WHERE ${vd.show})`.mapWith(Number),
      wallSeen: sql<number>`COUNT(*) FILTER (WHERE ${vd.wall})`.mapWith(Number),
      registered: sql<number>`COUNT(*) FILTER (WHERE ${registered})`.mapWith(Number),
      started: sql<number>`COUNT(*) FILTER (WHERE ${registered} AND ${fe.userId} IS NOT NULL)`.mapWith(
        Number,
      ),
      d25: depth(0.25),
      d50: depth(0.5),
      d80: depth(0.8),
      d100: sql<number>`COUNT(*) FILTER (WHERE ${started} AND ${finishedSql(
        { completed: fe.completed, maxPositionSeconds: fe.maxPositionSeconds },
        sql`${episodes.durationSeconds}`,
      )})`.mapWith(Number),
    })
    .from(visitors)
    .leftJoin(vd, eq(vd.aid, visitors.aid))
    .leftJoin(
      users,
      and(
        eq(users.id, visitors.userId),
        gte(users.createdAt, sql`${visitors.firstSeenAt} - interval '1 hour'`),
        eq(users.signupOrigin, "clerk_signup"),
      ),
    )
    .leftJoin(fe, eq(fe.userId, users.id))
    .leftJoin(episodes, eq(episodes.id, fe.episodeId))
    .where(and(...conds));

  return {
    cohort: row?.cohort ?? 0,
    landedHome: row?.landedHome ?? 0,
    showViewed: row?.showViewed ?? 0,
    wallSeen: row?.wallSeen ?? 0,
    registered: row?.registered ?? 0,
    started: row?.started ?? 0,
    d25: row?.d25 ?? 0,
    d50: row?.d50 ?? 0,
    d80: row?.d80 ?? 0,
    d100: row?.d100 ?? 0,
  };
}

// --- Blocks 4 + 5: geo and source × geo ------------------------------------

export type GeoRow = {
  country: string; // ISO2, or "" for unknown
  visits: number;
  registrations: number;
  /** % of that country's started episodes that finished, null = no starts */
  completionRate: number | null;
  /** release retention for that country's users, null = no finishers */
  releaseRetention: number | null;
};

export type GeoData = {
  /** iso2 → registrations (map fill) */
  mapData: Record<string, number>;
  rows: GeoRow[];
};

export async function loadSpecGeo(f: SpecFilters): Promise<GeoData> {
  const uv = userVisitorSq();

  const visitConds = [
    gte(visitorDays.day, ymd(f.from)),
    lte(visitorDays.day, ymd(f.to)),
  ];
  if (f.source !== "all") visitConds.push(eq(sourceBucketSql, f.source));

  const regConds = [newUserWhere(f.from, f.to)];
  if (f.source !== "all") regConds.push(eq(uv.source, f.source));

  const wpConds = [
    gte(watchProgress.firstWatchedAt, f.from),
    lte(watchProgress.firstWatchedAt, f.to),
  ];

  const [visitRows, regRows, wpRows, releaseStats] = await Promise.all([
    db
      .select({
        country: visitors.country,
        n: countDistinct(visitorDays.aid),
      })
      .from(visitorDays)
      .innerJoin(visitors, eq(visitors.aid, visitorDays.aid))
      .where(and(...visitConds))
      .groupBy(visitors.country),
    db
      .select({ country: users.country, n: count() })
      .from(users)
      .leftJoin(uv, eq(uv.userId, users.id))
      .where(and(...regConds))
      .groupBy(users.country),
    (() => {
      const q = db
        .select({
          country: users.country,
          started: count(),
          finished: sql<number>`COUNT(*) FILTER (WHERE ${finishedSql(watchProgress, sql`${episodes.durationSeconds}`)})`.mapWith(
            Number,
          ),
        })
        .from(watchProgress)
        .innerJoin(users, eq(users.id, watchProgress.userId))
        .innerJoin(episodes, eq(episodes.id, watchProgress.episodeId));
      const conds = [...wpConds];
      if (f.source !== "all") {
        // source lens on watch data goes through the user's first visitor
        const uv2 = userVisitorSq();
        return q
          .leftJoin(uv2, eq(uv2.userId, users.id))
          .where(and(...conds, eq(uv2.source, f.source)))
          .groupBy(users.country);
      }
      return q.where(and(...conds)).groupBy(users.country);
    })(),
    loadReleaseStats(),
  ]);

  const byCountry = new Map<string, GeoRow>();
  const rowFor = (c: string | null) => {
    const key = c ?? "";
    let r = byCountry.get(key);
    if (!r) {
      byCountry.set(
        key,
        (r = {
          country: key,
          visits: 0,
          registrations: 0,
          completionRate: null,
          releaseRetention: null,
        }),
      );
    }
    return r;
  };
  for (const r of visitRows) rowFor(r.country).visits += r.n;
  for (const r of regRows) rowFor(r.country).registrations += r.n;
  for (const r of wpRows) {
    const row = rowFor(r.country);
    row.completionRate = r.started > 0 ? (r.finished / r.started) * 100 : null;
  }
  // Release retention per country (all pairs, source-filtered).
  const rrByCountry = new Map<string, { fin: number; ret: number }>();
  for (const pair of releaseStats.pairs) {
    for (const cell of pair.cells) {
      if (f.source !== "all" && cell.source !== f.source) continue;
      const key = cell.country ?? "";
      const agg = rrByCountry.get(key) ?? { fin: 0, ret: 0 };
      agg.fin += cell.finishers;
      agg.ret += cell.returned;
      rrByCountry.set(key, agg);
    }
  }
  for (const [key, agg] of rrByCountry) {
    if (agg.fin > 0) rowFor(key).releaseRetention = (agg.ret / agg.fin) * 100;
  }

  const rows = [...byCountry.values()].sort((a, b) => b.visits - a.visits);
  const mapData: Record<string, number> = {};
  for (const r of rows) {
    if (r.country && r.registrations > 0) mapData[r.country] = r.registrations;
  }
  return { mapData, rows };
}

export type MatrixCell = {
  source: SourceBucket;
  country: string;
  visits: number;
  registrations: number;
  /** registrations / visits, % */
  regConversion: number | null;
  /** % of the cell's new users whose first episode reached ≥80% */
  deepWatch: number | null;
};

export type MatrixData = {
  countries: string[]; // top-N columns by visits
  cells: MatrixCell[];
};

const MATRIX_TOP_COUNTRIES = 5;

export async function loadSourceGeoMatrix(f: SpecFilters): Promise<MatrixData> {
  const uv = userVisitorSq();
  const fe = firstEpisodeSq();

  const [visitRows, userRows] = await Promise.all([
    db
      .select({
        source: sourceBucketSql,
        country: visitors.country,
        n: countDistinct(visitorDays.aid),
      })
      .from(visitorDays)
      .innerJoin(visitors, eq(visitors.aid, visitorDays.aid))
      .where(
        and(gte(visitorDays.day, ymd(f.from)), lte(visitorDays.day, ymd(f.to))),
      )
      .groupBy(sourceBucketSql, visitors.country),
    db
      .select({
        source: uv.source,
        country: users.country,
        regs: count(),
        deep: sql<number>`COUNT(*) FILTER (WHERE ${deepWatchSql(fe.maxPositionSeconds)})`.mapWith(
          Number,
        ),
      })
      .from(users)
      .leftJoin(uv, eq(uv.userId, users.id))
      .leftJoin(fe, eq(fe.userId, users.id))
      .leftJoin(episodes, eq(episodes.id, fe.episodeId))
      .where(newUserWhere(f.from, f.to))
      .groupBy(uv.source, users.country),
  ]);

  // Top countries by visits (known geo only).
  const visitsByCountry = new Map<string, number>();
  for (const r of visitRows) {
    if (!r.country) continue;
    visitsByCountry.set(r.country, (visitsByCountry.get(r.country) ?? 0) + r.n);
  }
  const countries = [...visitsByCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MATRIX_TOP_COUNTRIES)
    .map(([c]) => c);

  const key = (s: string, c: string) => `${s}|${c}`;
  const cellMap = new Map<string, MatrixCell>();
  const cellFor = (s: SourceBucket, c: string) => {
    let cell = cellMap.get(key(s, c));
    if (!cell) {
      cellMap.set(
        key(s, c),
        (cell = {
          source: s,
          country: c,
          visits: 0,
          registrations: 0,
          regConversion: null,
          deepWatch: null,
        }),
      );
    }
    return cell;
  };
  const toBucket = (s: string | null): SourceBucket =>
    (SOURCE_BUCKETS as readonly string[]).includes(s ?? "")
      ? (s as SourceBucket)
      : "direct";

  for (const r of visitRows) {
    if (!r.country || !countries.includes(r.country)) continue;
    cellFor(toBucket(r.source), r.country).visits += r.n;
  }
  const deepByCell = new Map<string, { regs: number; deep: number }>();
  for (const r of userRows) {
    if (!r.country || !countries.includes(r.country)) continue;
    const k = key(toBucket(r.source), r.country);
    const agg = deepByCell.get(k) ?? { regs: 0, deep: 0 };
    agg.regs += r.regs;
    agg.deep += r.deep;
    deepByCell.set(k, agg);
  }
  for (const [k, agg] of deepByCell) {
    const [s, c] = k.split("|");
    const cell = cellFor(s as SourceBucket, c);
    cell.registrations = agg.regs;
    cell.deepWatch = agg.regs > 0 ? (agg.deep / agg.regs) * 100 : null;
  }
  for (const cell of cellMap.values()) {
    cell.regConversion =
      cell.visits > 0 ? (cell.registrations / cell.visits) * 100 : null;
  }

  return { countries, cells: [...cellMap.values()] };
}

// --- Block 6: content ------------------------------------------------------

export type ContentRow = {
  episodeId: string;
  showId: string;
  showTitle: string;
  showSlug: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  durationSeconds: number | null;
  starts: number;
  completionRate: number | null;
  avgWatchedPct: number | null;
  rewatchers: number;
};

export async function loadContentTable(f: SpecFilters): Promise<ContentRow[]> {
  const wpConds = [
    gte(watchProgress.firstWatchedAt, f.from),
    lte(watchProgress.firstWatchedAt, f.to),
  ];
  const uv = userVisitorSq();
  const needUserLens = f.source !== "all" || f.country !== "all";

  const wpAgg = (() => {
    let q = db
      .select({
        episodeId: watchProgress.episodeId,
        starts: count().as("starts"),
        finished: sql<number>`COUNT(*) FILTER (WHERE ${finishedSql(watchProgress, sql`${episodes.durationSeconds}`)})`
          .mapWith(Number)
          .as("finished"),
        avgPct: sql<number | null>`AVG(LEAST(${watchProgress.maxPositionSeconds}::float / NULLIF(${episodes.durationSeconds}, 0), 1)) * 100`.as(
          "avg_pct",
        ),
        rewatchers: sql<number>`COUNT(*) FILTER (WHERE COALESCE(${episodes.durationSeconds}, 0) > 0 AND ${watchProgress.totalWatchedSeconds} >= ${REWATCH_FRACTION}::float8 * ${episodes.durationSeconds})`
          .mapWith(Number)
          .as("rewatchers"),
      })
      .from(watchProgress)
      .innerJoin(episodes, eq(episodes.id, watchProgress.episodeId))
      .$dynamic();
    if (needUserLens) {
      q = q
        .innerJoin(users, eq(users.id, watchProgress.userId))
        .leftJoin(uv, eq(uv.userId, users.id));
      const conds = [...wpConds];
      if (f.country !== "all") conds.push(eq(users.country, f.country));
      if (f.source !== "all") conds.push(eq(uv.source, f.source));
      return q.where(and(...conds)).groupBy(watchProgress.episodeId);
    }
    return q.where(and(...wpConds)).groupBy(watchProgress.episodeId);
  })().as("wpa");

  const rows = await db
    .select({
      episodeId: episodes.id,
      showId: seasons.showId,
      showTitle: shows.title,
      showSlug: shows.slug,
      seasonNumber: seasons.number,
      episodeNumber: episodes.number,
      title: episodes.title,
      durationSeconds: episodes.durationSeconds,
      starts: sql<number>`COALESCE(${wpAgg.starts}, 0)`.mapWith(Number),
      finished: sql<number>`COALESCE(${wpAgg.finished}, 0)`.mapWith(Number),
      avgPct: wpAgg.avgPct,
      rewatchers: sql<number>`COALESCE(${wpAgg.rewatchers}, 0)`.mapWith(Number),
    })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .innerJoin(shows, eq(shows.id, seasons.showId))
    .leftJoin(wpAgg, eq(wpAgg.episodeId, episodes.id))
    .where(
      and(
        eq(episodes.status, "ready"),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .orderBy(asc(shows.title), asc(seasons.number), asc(episodes.number));

  return rows.map((r) => ({
    episodeId: r.episodeId,
    showId: r.showId,
    showTitle: r.showTitle,
    showSlug: r.showSlug,
    seasonNumber: r.seasonNumber,
    episodeNumber: r.episodeNumber,
    title: r.title,
    durationSeconds: r.durationSeconds,
    starts: r.starts,
    completionRate: r.starts > 0 ? (r.finished / r.starts) * 100 : null,
    avgWatchedPct: r.avgPct == null ? null : Number(r.avgPct),
    rewatchers: r.rewatchers,
  }));
}

export type RetentionCurve = {
  episodeId: string;
  title: string;
  showTitle: string;
  episodeNumber: number;
  seasonNumber: number;
  durationSeconds: number | null;
  bucketSeconds: number;
  /** dense series from bucket 0 to the episode's last bucket */
  buckets: { bucket: number; views: number }[];
};

export async function loadRetentionCurve(
  episodeId: string,
  f: SpecFilters,
): Promise<RetentionCurve | null> {
  const [ep] = await db
    .select({
      id: episodes.id,
      title: episodes.title,
      number: episodes.number,
      seasonNumber: seasons.number,
      showTitle: shows.title,
      durationSeconds: episodes.durationSeconds,
    })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .innerJoin(shows, eq(shows.id, seasons.showId))
    .where(eq(episodes.id, episodeId))
    .limit(1);
  if (!ep) return null;

  const rows = await db
    .select({
      bucket: watchSegments.bucket,
      views: sql<number>`SUM(${watchSegments.views})`.mapWith(Number),
    })
    .from(watchSegments)
    .where(
      and(
        eq(watchSegments.episodeId, episodeId),
        gte(watchSegments.day, ymd(f.from)),
        lte(watchSegments.day, ymd(f.to)),
      ),
    )
    .groupBy(watchSegments.bucket)
    .orderBy(asc(watchSegments.bucket));

  const byBucket = new Map(rows.map((r) => [r.bucket, r.views]));
  const lastBucket = ep.durationSeconds
    ? Math.floor(ep.durationSeconds / WATCH_SEGMENT_BUCKET_SECONDS)
    : rows.length > 0
      ? rows[rows.length - 1].bucket
      : 0;
  const buckets: { bucket: number; views: number }[] = [];
  for (let b = 0; b <= lastBucket; b++) {
    buckets.push({ bucket: b, views: byBucket.get(b) ?? 0 });
  }

  return {
    episodeId: ep.id,
    title: ep.title,
    showTitle: ep.showTitle,
    episodeNumber: ep.number,
    seasonNumber: ep.seasonNumber,
    durationSeconds: ep.durationSeconds,
    bucketSeconds: WATCH_SEGMENT_BUCKET_SECONDS,
    buckets,
  };
}

export type WatchTimeWidget = {
  /** total seconds actually watched in range (segments, rewatches incl.) */
  totalWatchedSeconds: number;
  /** (user, day) active pairs in range */
  viewerDays: number;
  /** avg seconds watched per active viewer-day */
  avgPerViewerDay: number | null;
};

export async function loadWatchTimeWidget(
  f: SpecFilters,
): Promise<WatchTimeWidget> {
  const [[seg], [wd]] = await Promise.all([
    db
      .select({
        n: sql<number>`COALESCE(SUM(${watchSegments.views}), 0) * ${WATCH_SEGMENT_BUCKET_SECONDS}`.mapWith(
          Number,
        ),
      })
      .from(watchSegments)
      .where(
        and(gte(watchSegments.day, ymd(f.from)), lte(watchSegments.day, ymd(f.to))),
      ),
    db
      .select({ n: count() })
      .from(watchDays)
      .where(and(gte(watchDays.day, ymd(f.from)), lte(watchDays.day, ymd(f.to)))),
  ]);
  const total = seg?.n ?? 0;
  const days = wd?.n ?? 0;
  return {
    totalWatchedSeconds: total,
    viewerDays: days,
    avgPerViewerDay: days > 0 ? total / days : null,
  };
}

// Countries present in the visit ledger — options for the geo filter,
// ordered by visitor volume.
export async function loadCountryOptions(): Promise<string[]> {
  const rows = await db
    .select({ country: visitors.country, n: count() })
    .from(visitors)
    .where(isNotNull(visitors.country))
    .groupBy(visitors.country)
    .orderBy(sql`count(*) DESC`)
    .limit(40);
  return rows.map((r) => r.country!).filter(Boolean);
}

// --- Block 7 + shared release machinery ------------------------------------

export type ReleasePairCell = {
  country: string | null;
  source: string | null;
  finishers: number;
  returned: number;
};

export type ReleasePair = {
  showId: string;
  showTitle: string;
  showSlug: string;
  prevEpisodeId: string;
  prevEpisodeNumber: number;
  prevSeasonNumber: number;
  nextEpisodeId: string;
  nextEpisodeNumber: number;
  nextSeasonNumber: number;
  nextTitle: string;
  /** effective release of the NEXT episode (released_at, else first watch) */
  release: Date | null;
  cells: ReleasePairCell[];
  totalFinishers: number;
  totalReturned: number;
};

export type ReleaseStats = { pairs: ReleasePair[] };

// Consecutive (ep N, ep N+1) pairs across every published show, with per-
// (country, source) finisher/returner counts. Effective release =
// released_at (stamped by the publish action / Mux webhook since 2026-07)
// falling back to the episode's first observed watch for the back
// catalog. One small query per pair — the catalog is tens of episodes.
// React-cache()d: the KPI row, pulse markers, geo table, and block 7 all
// consume it within one request.
export const loadReleaseStats = cache(_loadReleaseStats);

async function _loadReleaseStats(): Promise<ReleaseStats> {
  const eps = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      durationSeconds: episodes.durationSeconds,
      releasedAt: episodes.releasedAt,
      seasonNumber: seasons.number,
      showId: seasons.showId,
      showTitle: shows.title,
      showSlug: shows.slug,
    })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .innerJoin(shows, eq(shows.id, seasons.showId))
    .where(
      and(
        eq(episodes.status, "ready"),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .orderBy(asc(seasons.showId), asc(seasons.number), asc(episodes.number));

  if (eps.length === 0) return { pairs: [] };

  // First observed watch per episode — release fallback for the back
  // catalog (released_at was only wired up with this dashboard).
  const firstWatch = await db
    .select({
      episodeId: watchProgress.episodeId,
      first: min(watchProgress.firstWatchedAt),
    })
    .from(watchProgress)
    .where(
      inArray(
        watchProgress.episodeId,
        eps.map((e) => e.id),
      ),
    )
    .groupBy(watchProgress.episodeId);
  const firstWatchByEp = new Map(firstWatch.map((r) => [r.episodeId, r.first]));

  const pairs: Omit<ReleasePair, "cells" | "totalFinishers" | "totalReturned">[] =
    [];
  for (let i = 1; i < eps.length; i++) {
    const prev = eps[i - 1];
    const next = eps[i];
    if (prev.showId !== next.showId) continue;
    const release = next.releasedAt ?? firstWatchByEp.get(next.id) ?? null;
    pairs.push({
      showId: next.showId,
      showTitle: next.showTitle,
      showSlug: next.showSlug,
      prevEpisodeId: prev.id,
      prevEpisodeNumber: prev.number,
      prevSeasonNumber: prev.seasonNumber,
      nextEpisodeId: next.id,
      nextEpisodeNumber: next.number,
      nextSeasonNumber: next.seasonNumber,
      nextTitle: next.title,
      release,
    });
  }

  const durationByEp = new Map(eps.map((e) => [e.id, e.durationSeconds]));

  const withCells = await Promise.all(
    pairs.map(async (pair): Promise<ReleasePair> => {
      if (!pair.release) {
        return { ...pair, cells: [], totalFinishers: 0, totalReturned: 0 };
      }
      const cutoff = new Date(
        pair.release.getTime() + RELEASE_RETENTION_WINDOW_DAYS * DAY_MS,
      );
      const wpNext = alias(watchProgress, "wp_next");
      const uv = userVisitorSq();
      const prevDuration = durationByEp.get(pair.prevEpisodeId) ?? null;
      const cells = await db
        .select({
          country: users.country,
          source: uv.source,
          finishers: count(),
          returned: sql<number>`COUNT(*) FILTER (WHERE ${wpNext.userId} IS NOT NULL)`.mapWith(
            Number,
          ),
        })
        .from(watchProgress)
        .innerJoin(users, eq(users.id, watchProgress.userId))
        .leftJoin(uv, eq(uv.userId, users.id))
        .leftJoin(
          wpNext,
          and(
            eq(wpNext.userId, watchProgress.userId),
            eq(wpNext.episodeId, pair.nextEpisodeId),
            lte(wpNext.firstWatchedAt, cutoff),
          ),
        )
        .where(
          and(
            eq(watchProgress.episodeId, pair.prevEpisodeId),
            finishedSql(watchProgress, sql`${prevDuration}::int`),
          ),
        )
        .groupBy(users.country, uv.source);
      return {
        ...pair,
        cells: cells.map((c) => ({
          country: c.country,
          source: c.source,
          finishers: c.finishers,
          returned: c.returned,
        })),
        totalFinishers: cells.reduce((a, c) => a + c.finishers, 0),
        totalReturned: cells.reduce((a, c) => a + c.returned, 0),
      };
    }),
  );

  return { pairs: withCells };
}

export type ShowReleaseRetention = {
  showId: string;
  showTitle: string;
  showSlug: string;
  pairs: {
    label: string; // "s1e1 → s1e2"
    nextTitle: string;
    release: Date | null;
    finishers: number;
    returned: number;
    pct: number | null;
  }[];
};

// Block 7 view: per-show pair list, optionally through the source/country
// lens. Deliberately period-independent — it fills in as episodes release.
export function shapeReleaseRetention(
  stats: ReleaseStats,
  f: SpecFilters,
): ShowReleaseRetention[] {
  const byShow = new Map<string, ShowReleaseRetention>();
  for (const pair of stats.pairs) {
    let show = byShow.get(pair.showId);
    if (!show) {
      byShow.set(
        pair.showId,
        (show = {
          showId: pair.showId,
          showTitle: pair.showTitle,
          showSlug: pair.showSlug,
          pairs: [],
        }),
      );
    }
    let finishers = 0;
    let returned = 0;
    for (const cell of pair.cells) {
      if (f.country !== "all" && cell.country !== f.country) continue;
      if (f.source !== "all" && cell.source !== f.source) continue;
      finishers += cell.finishers;
      returned += cell.returned;
    }
    show.pairs.push({
      label: `S${pair.prevSeasonNumber}E${pair.prevEpisodeNumber} → S${pair.nextSeasonNumber}E${pair.nextEpisodeNumber}`,
      nextTitle: pair.nextTitle,
      release: pair.release,
      finishers,
      returned,
      pct: finishers > 0 ? (returned / finishers) * 100 : null,
    });
  }
  return [...byShow.values()];
}
