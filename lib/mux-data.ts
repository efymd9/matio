import "server-only";

// Server-side Mux Data API client for the admin analytics dashboard. Plain
// fetch + HTTP Basic auth (no SDK). Reads true watch-time / views / unique
// viewers from Mux (the player sends the beacons; this reads the aggregates),
// distinct from the approximate watch_progress-derived numbers.
//
// Requires a Mux access token with **Mux Data: Read** permission (separate from
// the Video token / signing key). Kept secret — server-only, never NEXT_PUBLIC.
// When unconfigured the dashboard degrades to a "connect" hint.

const MUX_DATA_BASE = "https://api.mux.com/data/v1";
// Data API is 5 req/s and a few minutes behind real time — cache aggressively.
const REVALIDATE_SECONDS = 300;
// Exclude the autoplay home hero so numbers reflect real content viewing.
const EXCLUDE_HERO_FILTER = "!player_name:matio-hero";

export type MuxTimeframe = "24:hours" | "7:days" | "30:days";

export type MuxWatchSummary = {
  watchTimeMs: number;
  playingTimeMs: number;
  views: number;
  uniqueViewers: number;
};

export type MuxShowRow = { show: string; views: number; watchTimeMs: number };

export type MuxDataResult =
  | { status: "ok"; summary: MuxWatchSummary; byShow: MuxShowRow[] }
  | { status: "not_configured" }
  | { status: "error"; message: string };

function getCreds(): { id: string; secret: string } | null {
  const id = process.env.MUX_DATA_API_TOKEN_ID;
  const secret = process.env.MUX_DATA_API_TOKEN_SECRET;
  if (!id || !secret) return null;
  return { id, secret };
}

async function muxFetch(
  path: string,
  creds: { id: string; secret: string },
): Promise<Response> {
  const auth = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
  return fetch(`${MUX_DATA_BASE}${path}`, {
    headers: { Authorization: `Basic ${auth}` },
    // Shared Data Cache across admin requests; keeps us well under 5 req/s.
    next: { revalidate: REVALIDATE_SECONDS },
  });
}

// comparison → data[].name==="totals" carries watch_time/view_count/
// unique_viewers/total_playing_time (all ms for the time fields).
type ComparisonResponse = {
  data?: Array<{
    name?: string;
    watch_time?: number;
    view_count?: number;
    unique_viewers?: number;
    total_playing_time?: number;
  }>;
};

// breakdown rows → { field: <dimension value>, views, total_watch_time(ms) }.
type BreakdownResponse = {
  data?: Array<{ field?: string; views?: number; total_watch_time?: number }>;
};

export async function getMuxData(
  timeframe: MuxTimeframe = "30:days",
): Promise<MuxDataResult> {
  const creds = getCreds();
  if (!creds) return { status: "not_configured" };

  const tf = `timeframe[]=${encodeURIComponent(timeframe)}`;
  const heroFilter = `filters[]=${encodeURIComponent(EXCLUDE_HERO_FILTER)}`;

  try {
    const [comparisonRes, breakdownRes] = await Promise.all([
      muxFetch(`/metrics/comparison?${tf}&${heroFilter}`, creds),
      muxFetch(
        `/metrics/video_startup_time/breakdown?group_by=video_series&${tf}&${heroFilter}&order_by=views&order_direction=desc&limit=100`,
        creds,
      ),
    ]);

    if (comparisonRes.status === 401 || comparisonRes.status === 403) {
      return {
        status: "error",
        message:
          "Mux Data API token rejected — the token needs Mux Data: Read permission for the production environment.",
      };
    }
    if (!comparisonRes.ok) {
      return { status: "error", message: `Mux Data API ${comparisonRes.status}` };
    }

    const comparison = (await comparisonRes.json()) as ComparisonResponse;
    const totals = comparison.data?.find((d) => d.name === "totals");
    const summary: MuxWatchSummary = {
      watchTimeMs: Number(totals?.watch_time ?? 0),
      playingTimeMs: Number(totals?.total_playing_time ?? 0),
      views: Number(totals?.view_count ?? 0),
      uniqueViewers: Number(totals?.unique_viewers ?? 0),
    };

    let byShow: MuxShowRow[] = [];
    if (breakdownRes.ok) {
      const breakdown = (await breakdownRes.json()) as BreakdownResponse;
      byShow = (breakdown.data ?? [])
        .filter((r) => r.field)
        .map((r) => ({
          show: String(r.field),
          views: Number(r.views ?? 0),
          watchTimeMs: Number(r.total_watch_time ?? 0),
        }));
    }

    return { status: "ok", summary, byShow };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Mux Data request failed",
    };
  }
}
