import "server-only";
import { unstable_cache } from "next/cache";
import { getPosthogQueryConfig, hogTs, runHogQL } from "@/lib/posthog-query";

// Data layer for /admin/analytics/sessions — a per-visit event feed in the
// spirit of a session log. The first-party ledger (visitors/visitor_days) is
// day-grain booleans by design and cannot order events within a visit, so
// this page reads PostHog instead: the same $session_id that groups the
// curated funnel events also groups $pageview/$pageleave, giving an ordered
// timeline per browser session. Trade-off (deliberate, noted in the UI):
// PostHog is consent-gated, so EU visitors who never accept the banner and
// some ad-blocked traffic are invisible here — fine for qualitative
// inspection, which is this page's job; counting stays on the DB dashboard.

// Only these events appear in timelines AND count toward a session's event
// total — an explicit whitelist so PostHog-internal noise ($identify,
// $web_vitals, heatmap batches…) can never flood a session row. Server-side
// events (checkout_started, subscribe_succeeded) carry no $session_id and
// are listed for completeness only.
const TIMELINE_EVENTS = [
  "$pageview",
  "$pageleave",
  "show_viewed",
  "trial_play_started",
  "free_episode_started",
  "member_episode_started",
  "play_attempted",
  "first_frame",
  "playback_failed",
  "episode_auto_advanced",
  "signup_wall_shown",
  "paywall_shown",
  "signup_cta_clicked",
  "signup_completed",
  "checkout_started",
  "subscribe_succeeded",
  "welcome_signin_succeeded",
  "welcome_signin_failed",
  "welcome_fallback_shown",
] as const;

const EVENT_LIST = TIMELINE_EVENTS.map((e) => `'${e}'`).join(", ");

// PostHog session ids are UUIDv7 strings minted by posthog-js. Validate
// before interpolating back into the timeline/replay queries — anything
// unexpected is dropped, never quoted into HogQL.
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SESSIONS_RANGES = ["24h", "7d", "30d"] as const;
export type SessionsRange = (typeof SESSIONS_RANGES)[number];
const RANGE_DAYS: Record<SessionsRange, number> = { "24h": 1, "7d": 7, "30d": 30 };

export const SESSIONS_DEFAULT_RANGE: SessionsRange = "7d";
export const SESSIONS_DEFAULT_LIMIT = 50;
export const SESSIONS_MAX_LIMIT = 400;
// Display cap per expanded session — a pathological tab left open for hours
// must not dominate the page.
const EVENTS_PER_SESSION_CAP = 80;
// Global timeline fetch cap (sessions average well under 10 events each, so
// this only bites on extreme windows; trimmed oldest-first — see below).
const TIMELINE_ROW_CAP = 4000;

// The /query endpoint is rate-limited per personal API key; a 60s cache
// absorbs refresh-spam while keeping the feed effectively live.
const REVALIDATE_SECONDS = 60;
const ROUND_MS = REVALIDATE_SECONDS * 1000;

export type SessionEvent = {
  event: string;
  /** ISO timestamp (UTC) */
  ts: string;
  path: string | null;
  showSlug: string | null;
  episodeNumber: number | null;
  mode: string | null;
  auth: string | null;
};

export type SessionSummary = {
  id: string;
  /** ISO timestamps (UTC) */
  startedAt: string;
  endedAt: string;
  eventCount: number;
  pageviews: number;
  country: string | null;
  device: string | null;
  /** Person email — present once the visitor is (eventually) identified. */
  email: string | null;
  /** First-event referrer; null = direct. */
  referrer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  /** Ordered unique-consecutive $pageview paths. */
  paths: string[];
  hasReplay: boolean;
  events: SessionEvent[];
  /** Path of the true last fetched event — captured BEFORE the display cap,
   * so "ended on" stays correct for truncated timelines. */
  exitPath: string | null;
  /** Events not shown in `events` (display cap + global fetch cap; 0 = the
   * timeline is complete). */
  hiddenEvents: number;
};

export type SessionsResult =
  | {
      status: "ok";
      sessions: SessionSummary[];
      /** Load-time epoch ms — the page's time-ago anchor, so render stays
       * pure (react-hooks/purity forbids Date.now() in render). */
      now: number;
    }
  | { status: "not_configured" }
  | { status: "error"; message: string };

export function parseSessionsParams(
  sp: Record<string, string | string[] | undefined>,
): { range: SessionsRange; limit: number } {
  const rawRange = typeof sp.range === "string" ? sp.range : "";
  const range = (SESSIONS_RANGES as readonly string[]).includes(rawRange)
    ? (rawRange as SessionsRange)
    : SESSIONS_DEFAULT_RANGE;
  const rawN = typeof sp.n === "string" ? Number.parseInt(sp.n, 10) : NaN;
  const limit = Number.isFinite(rawN)
    ? Math.min(Math.max(rawN, 10), SESSIONS_MAX_LIMIT)
    : SESSIONS_DEFAULT_LIMIT;
  return { range, limit };
}

/** PostHog UI deep link to the session's replay (recording existence is
 * checked separately — see hasReplay). */
export function sessionReplayUrl(sessionId: string): string | null {
  const cfg = getPosthogQueryConfig();
  if (!cfg) return null;
  return `https://eu.posthog.com/project/${cfg.projectId}/replay/${sessionId}`;
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === "" ? null : s;
}

function asIso(v: unknown): string {
  // HogQL returns 'YYYY-MM-DDTHH:MM:SS.ssssssZ' (project TZ is UTC) —
  // normalize through Date so downstream math never guesses the format.
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

async function fetchSessions(
  projectId: string,
  fromTs: string,
  toTs: string,
  limit: number,
): Promise<SessionSummary[]> {
  const cfg = getPosthogQueryConfig();
  if (!cfg || cfg.projectId !== projectId) {
    throw new Error("PostHog query API not configured");
  }
  const range = `timestamp >= toDateTime('${fromTs}') AND timestamp <= toDateTime('${toTs}')`;

  // One row per session, most recently active first. argMin/argMax skip
  // NULLs, so referrer/UTM come from the earliest event carrying them and
  // email appears as soon as any event in the session is identified.
  const listRows = await runHogQL(
    cfg,
    `SELECT $session_id AS sid,
       min(timestamp) AS started_at,
       max(timestamp) AS ended_at,
       count() AS event_count,
       countIf(event = '$pageview') AS pageviews,
       any(properties.$geoip_country_code) AS country,
       any(properties.$device_type) AS device,
       argMax(person.properties.email, timestamp) AS email,
       argMin(properties.$referrer, timestamp) AS referrer,
       argMin(properties.utm_source, timestamp) AS utm_source,
       argMin(properties.utm_campaign, timestamp) AS utm_campaign
     FROM events
     WHERE event IN (${EVENT_LIST})
       AND ${range}
       AND notEmpty(toString($session_id))
     GROUP BY sid
     ORDER BY ended_at DESC
     LIMIT ${limit}`,
  );

  const sessions = listRows.flatMap((r): SessionSummary[] => {
    const id = asStr(r[0]);
    if (!id || !SESSION_ID_RE.test(id)) return [];
    const referrer = asStr(r[8]);
    return [
      {
        id,
        startedAt: asIso(r[1]),
        endedAt: asIso(r[2]),
        eventCount: Number(r[3] ?? 0),
        pageviews: Number(r[4] ?? 0),
        country: asStr(r[5]),
        device: asStr(r[6]),
        email: asStr(r[7]),
        referrer: referrer === "$direct" ? null : referrer,
        utmSource: asStr(r[9]),
        utmCampaign: asStr(r[10]),
        paths: [] as string[],
        hasReplay: false,
        events: [] as SessionEvent[],
        exitPath: null,
        hiddenEvents: 0,
      } satisfies SessionSummary,
    ];
  });
  if (sessions.length === 0) return [];

  const idList = sessions.map((s) => `'${s.id}'`).join(", ");
  const [eventRows, replayRows] = await Promise.all([
    // DESC + reverse in JS: if the global cap ever bites it trims the OLDEST
    // events, so the most recent sessions keep complete timelines.
    runHogQL(
      cfg,
      `SELECT $session_id AS sid, event, timestamp,
         properties.$pathname AS path,
         properties.show_slug AS show_slug,
         properties.episode_number AS episode_number,
         properties.mode AS mode,
         properties.auth AS auth
       FROM events
       WHERE event IN (${EVENT_LIST})
         AND ${range}
         AND $session_id IN (${idList})
       ORDER BY timestamp DESC
       LIMIT ${TIMELINE_ROW_CAP}`,
    ),
    // Replay rows land moments after the session starts; the 1h pad covers
    // sessions straddling the window's left edge.
    runHogQL(
      cfg,
      `SELECT session_id FROM session_replay_events
       WHERE start_time >= toDateTime('${fromTs}') - INTERVAL 1 HOUR
         AND is_deleted = 0
         AND session_id IN (${idList})`,
    ),
  ]);

  const bySession = new Map(sessions.map((s) => [s.id, s]));
  for (const r of eventRows.reverse()) {
    const s = bySession.get(String(r[0]));
    if (!s) continue;
    const epRaw = r[5];
    s.events.push({
      event: String(r[1]),
      ts: asIso(r[2]),
      path: asStr(r[3]),
      showSlug: asStr(r[4]),
      episodeNumber: epRaw == null ? null : Math.round(Number(epRaw)),
      mode: asStr(r[6]),
      auth: asStr(r[7]),
    });
  }

  for (const s of sessions) {
    for (const e of s.events) {
      if (e.event !== "$pageview" || !e.path) continue;
      if (s.paths[s.paths.length - 1] !== e.path) s.paths.push(e.path);
    }
    // Capture the exit BEFORE capping — the cap keeps the oldest events.
    s.exitPath =
      s.events.length > 0 ? s.events[s.events.length - 1].path : null;
    if (s.events.length > EVENTS_PER_SESSION_CAP) {
      s.events = s.events.slice(0, EVENTS_PER_SESSION_CAP);
    }
    // eventCount is the authoritative count() from the list query; the shown
    // timeline can fall short of it via the per-session cap OR the global
    // TIMELINE_ROW_CAP trim, so derive "N more" from the total — shown +
    // hidden always equals eventCount.
    s.hiddenEvents = Math.max(0, s.eventCount - s.events.length);
  }

  for (const r of replayRows) {
    const s = bySession.get(String(r[0]));
    if (s) s.hasReplay = true;
  }

  return sessions;
}

// Cache on (project id, rounded window, limit); errors are never cached, so
// a transient PostHog failure doesn't stick for a minute.
const cachedFetchSessions = unstable_cache(
  fetchSessions,
  ["posthog-sessions"],
  { revalidate: REVALIDATE_SECONDS },
);

export async function loadRecentSessions(
  range: SessionsRange,
  limit: number,
): Promise<SessionsResult> {
  const cfg = getPosthogQueryConfig();
  if (!cfg) return { status: "not_configured" };
  // Round the window edges so the cache key repeats across renders within
  // the revalidate period (same trick as signupFunnelWindow).
  const now = Date.now();
  const to = Math.ceil(now / ROUND_MS) * ROUND_MS;
  const from = to - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
  try {
    return {
      status: "ok",
      sessions: await cachedFetchSessions(
        cfg.projectId,
        hogTs(new Date(from)),
        hogTs(new Date(to)),
        limit,
      ),
      now,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "PostHog query failed",
    };
  }
}
