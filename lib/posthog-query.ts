import "server-only";
import { unstable_cache } from "next/cache";
import { DIRECT_BUCKET } from "@/lib/admin-analytics";
import { UTM_SOURCE_ALIASES } from "@/lib/utm";

// Server-side PostHog HogQL client. Plain fetch + Bearer auth (no SDK) —
// same bounded-external-call contract as lib/mux-data.ts. Two consumers:
// the legacy dashboard's signup-funnel panel (dormant, paid mode) and
// lib/posthog-sessions.ts (/admin/analytics/sessions), which imports the
// exported config/hogTs/runHogQL primitives.
//
// Requires a PostHog **personal API key** with the query:read scope — the
// public phc_… project key (NEXT_PUBLIC_POSTHOG_KEY) cannot run queries —
// plus the numeric project id. Unconfigured → the panel degrades to a
// connect hint, never breaks the page.
//
// The query API lives on the app host (eu.posthog.com), NOT the ingestion
// host in POSTHOG_HOST (eu.i.posthog.com) — hence the separate env var.

const POSTHOG_API_HOST =
  process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com";
// The /query endpoint is rate-limited per personal API key — cache
// aggressively; the panel is a 5-minute-fresh aggregate, not a live feed.
const REVALIDATE_SECONDS = 300;
const CACHE_ROUND_MS = REVALIDATE_SECONDS * 1000;

// Byte-compatible with lib/utm.ts normalizeUtm (and the saved insights'
// HogQL breakdowns — see the PostHog rule in CLAUDE.md): trim → lower →
// strip everything outside [a-z0-9_-]. The client before_send hook already
// normalizes new events; the regexp here also fixes pre-hook history, so
// sources read identically to the DB attribution columns. The no-UTM bucket
// interpolates the shared DIRECT_BUCKET constant so this panel can never
// drift from the DB-driven sources/campaign tables on the same page.
const RAW_SRC_EXPR = `coalesce(nullif(replaceRegexpAll(lower(trim(coalesce(toString(properties.utm_source), ''))), '[^a-z0-9_-]', ''), ''), '${DIRECT_BUCKET}')`;

// The attribution pipeline writes sources through normalizeUtmSource
// (facebook/meta → fb, instagram → ig) — apply the SAME aliasing here, with
// the transform() arrays GENERATED from the shared table so the two layers
// can never drift ("facebook" showing beside "fb" would read as a data bug).
// Values are code-owned [a-z] literals — safe to inline into the query.
const ALIAS_FROM = Object.keys(UTM_SOURCE_ALIASES);
const ALIAS_TO = ALIAS_FROM.map((k) => UTM_SOURCE_ALIASES[k]);
const quoteList = (xs: string[]) => xs.map((x) => `'${x}'`).join(", ");
const SRC_EXPR = `transform(${RAW_SRC_EXPR}, [${quoteList(ALIAS_FROM)}], [${quoteList(ALIAS_TO)}], ${RAW_SRC_EXPR})`;

export type SignupFunnelSource = {
  source: string;
  visitors: number;
  wall: number;
};

export type SignupFunnelStats = {
  // Distinct persons with a $pageview in range.
  visitors: number;
  // Distinct persons who saw the signup wall (signup_wall_shown) in range.
  wallViewers: number;
  // Visitors split by normalized utm_source, wall reach attached per source.
  bySource: SignupFunnelSource[];
};

export type SignupFunnelResult =
  | { status: "ok"; stats: SignupFunnelStats }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export type PosthogQueryConfig = { key: string; projectId: string };

export function getPosthogQueryConfig(): PosthogQueryConfig | null {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!key || !projectId) return null;
  return { key, projectId };
}

// The cache-friendly query window: `from` floors and `to` ceils to 5-minute
// edges, so the unstable_cache key repeats across renders (range presets
// derive `to` from now() — un-rounded, every render would miss the cache and
// hit the rate-limited API) while never trimming data at the edges. The
// section component passes the SAME rounded window to loadSignupFunnelDb so
// the funnel's PostHog and DB stages cover an identical time span.
export function signupFunnelWindow(
  from: Date,
  to: Date,
): { from: Date; to: Date } {
  return {
    from: new Date(Math.floor(from.getTime() / CACHE_ROUND_MS) * CACHE_ROUND_MS),
    to: new Date(Math.ceil(to.getTime() / CACHE_ROUND_MS) * CACHE_ROUND_MS),
  };
}

// 'YYYY-MM-DD HH:MM:SS' for HogQL toDateTime — the project timezone is UTC,
// so the ISO slice is already in the right zone.
export function hogTs(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export async function runHogQL(
  cfg: PosthogQueryConfig,
  query: string,
): Promise<unknown[][]> {
  const res = await fetch(
    `${POSTHOG_API_HOST}/api/projects/${cfg.projectId}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      // POSTs bypass the fetch data cache anyway; caching happens at the
      // unstable_cache layer below where errors are NOT persisted.
      cache: "no-store",
      // A hung PostHog response must never stall the dashboard render —
      // the TimeoutError lands in getSignupFunnelStats's catch and degrades
      // to the panel's error state (same contract as lib/mux-data.ts).
      signal: AbortSignal.timeout(3500),
    },
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `PostHog query API ${res.status} — check that the personal API key has the query:read scope and that POSTHOG_PROJECT_ID (${cfg.projectId}) is a project the key can access.`,
    );
  }
  if (!res.ok) throw new Error(`PostHog query API ${res.status}`);
  const body = (await res.json()) as { results?: unknown[][] };
  return body.results ?? [];
}

// Two round-trips per cache miss: totals + by-source. The totals can't be
// derived from the by-source sums (one person can carry different sources on
// different events, and the source list is capped), hence the second query.
async function fetchStats(
  projectId: string,
  fromTs: string,
  toTs: string,
): Promise<SignupFunnelStats> {
  const cfg = getPosthogQueryConfig();
  if (!cfg || cfg.projectId !== projectId) {
    throw new Error("PostHog query API not configured");
  }
  const range = `timestamp >= toDateTime('${fromTs}') AND timestamp <= toDateTime('${toTs}')`;
  const both = `event IN ('$pageview', 'signup_wall_shown') AND ${range}`;
  const distinctIf = (event: string) =>
    `countDistinctIf(person_id, event = '${event}')`;

  const [totalRows, srcRows] = await Promise.all([
    runHogQL(
      cfg,
      `SELECT ${distinctIf("$pageview")} AS visitors, ${distinctIf("signup_wall_shown")} AS wall FROM events WHERE ${both}`,
    ),
    runHogQL(
      cfg,
      `SELECT ${SRC_EXPR} AS src, ${distinctIf("$pageview")} AS visitors, ${distinctIf("signup_wall_shown")} AS wall FROM events WHERE ${both} GROUP BY src ORDER BY visitors DESC LIMIT 12`,
    ),
  ]);

  return {
    visitors: Number(totalRows[0]?.[0] ?? 0),
    wallViewers: Number(totalRows[0]?.[1] ?? 0),
    bySource: srcRows.map((r) => ({
      source: String(r[0]),
      visitors: Number(r[1] ?? 0),
      wall: Number(r[2] ?? 0),
    })),
  };
}

// Cache on (project id, rounded window) — unstable_cache keys on its args, so
// results can never leak across projects, and thrown errors are not cached
// (a transient PostHog failure doesn't stick for 5 minutes).
const cachedFetchStats = unstable_cache(
  fetchStats,
  ["posthog-signup-funnel"],
  { revalidate: REVALIDATE_SECONDS },
);

// `from`/`to` may be raw filter dates or an already-rounded window — rounding
// is idempotent, so callers that shared signupFunnelWindow() with the DB
// stages get byte-identical cache keys.
export async function getSignupFunnelStats(
  from: Date,
  to: Date,
): Promise<SignupFunnelResult> {
  const cfg = getPosthogQueryConfig();
  if (!cfg) return { status: "not_configured" };
  const win = signupFunnelWindow(from, to);
  try {
    return {
      status: "ok",
      stats: await cachedFetchStats(
        cfg.projectId,
        hogTs(win.from),
        hogTs(win.to),
      ),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "PostHog query failed",
    };
  }
}
