// The PostHog HogQL transport: plain fetch + Bearer auth (no SDK), bounded
// by a timeout — the same external-call contract as lib/mux-data.ts.
//
// Universal on purpose (no `server-only`): besides the admin pages it is the
// transport behind `scripts/export-user-data.ts` (the art. 15/20 subject
// export), and a tsx script cannot import a `server-only` module — that
// marker throws outside a React server bundle. Nothing here reads the
// personal API key from the environment; the caller passes the config in
// (`lib/posthog-query.ts:getPosthogQueryConfig` for the app, the shell
// environment for the script), so this module holds no secret of its own.
//
// The query API lives on the app host (eu.posthog.com), NOT the ingestion
// host in POSTHOG_HOST (eu.i.posthog.com) — hence the separate env var.

const POSTHOG_API_HOST =
  process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com";

export type PosthogQueryConfig = { key: string; projectId: string };

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
      // unstable_cache layer in the callers where errors are NOT persisted.
      cache: "no-store",
      // A hung PostHog response must never stall the dashboard render —
      // the TimeoutError lands in the caller's catch and degrades to the
      // panel's error state (same contract as lib/mux-data.ts).
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
