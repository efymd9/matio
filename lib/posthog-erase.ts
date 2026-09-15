import { describeError } from "@/lib/observability";
import { POSTHOG_API_HOST, type PosthogQueryConfig } from "@/lib/posthog-hogql";

// Art. 17 at PostHog: delete the person behind a Clerk id (the app's
// `identify(userId, {email})` makes the Clerk id a distinct_id, and the
// person carries the address as a property) together with its events.
//
//   GET    /api/projects/{id}/persons/?distinct_id=<clerk id>   → person ids
//   DELETE /api/projects/{id}/persons/{personId}/?delete_events=true
//
// `delete_events=true` queues the events for PostHog's weekly async deletion
// (the person itself goes at once). Best-effort with the same contract as
// the Stripe cancellation in lib/erase-user.ts: one bounded attempt per
// request, no retries, never throws — a PostHog outage must not hold the
// local erasure back, and the honest typed status is what the caller logs
// and what the runbook's manual fallback keys on. `skipped_forbidden`
// (401/403) is a state, not an error: a personal key scoped query:read
// only cannot delete persons until person:write is added to it.
//
// Universal on purpose (no `server-only`, no env read — the config comes
// in, exactly like runHogQL): scripts/erase-user.ts runs the same code
// under tsx. Nothing from a PostHog response body is ever returned or
// logged except person ids — an error body quotes the request, and the
// request is a person.

export const POSTHOG_ERASE_TIMEOUT_MS = 5_000;

export type PosthogEraseStatus =
  | "deleted"
  | "not_found"
  | "skipped_unconfigured"
  | "skipped_forbidden"
  | "failed";

type PosthogDiagnostics = {
  /** The HTTP status that decided a skip or a failure. Never a body. */
  httpStatus?: number;
  /** For a thrown fetch (timeout, DNS, reset): class and code only. */
  error?: ReturnType<typeof describeError>;
};

export type PosthogEraseResult = PosthogDiagnostics & {
  status: PosthogEraseStatus;
  /** Person ids found for the distinct_id (PostHog's own ids, not the subject's). */
  personIds: string[];
};

export type PosthogLookupResult = PosthogDiagnostics & {
  status: Exclude<PosthogEraseStatus, "deleted"> | "found";
  personIds: string[];
};

function request(
  cfg: PosthogQueryConfig,
  path: string,
  init: { method?: string } = {},
): Promise<Response> {
  return fetch(
    `${POSTHOG_API_HOST}/api/projects/${encodeURIComponent(cfg.projectId)}/persons/${path}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${cfg.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(POSTHOG_ERASE_TIMEOUT_MS),
    },
  );
}

function isForbidden(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * The read half on its own: what `pnpm erase-user` prints in a dry run
 * (how many persons an --apply would delete — and, as a side effect,
 * whether the key can at least read persons).
 */
export async function lookupPosthogPersons(
  cfg: PosthogQueryConfig | null,
  distinctId: string,
): Promise<PosthogLookupResult> {
  if (!cfg) return { status: "skipped_unconfigured", personIds: [] };
  try {
    const res = await request(
      cfg,
      `?distinct_id=${encodeURIComponent(distinctId)}`,
    );
    if (isForbidden(res.status)) {
      return { status: "skipped_forbidden", personIds: [], httpStatus: res.status };
    }
    if (!res.ok) return { status: "failed", personIds: [], httpStatus: res.status };
    const body = (await res.json()) as { results?: unknown };
    const results = Array.isArray(body.results) ? body.results : [];
    const personIds = results
      .map((p) =>
        p && typeof p === "object" ? (p as { id?: unknown }).id : undefined,
      )
      .filter((id): id is string | number =>
        typeof id === "string" || typeof id === "number",
      )
      .map(String);
    return { status: personIds.length > 0 ? "found" : "not_found", personIds };
  } catch (err) {
    return { status: "failed", personIds: [], error: describeError(err) };
  }
}

export async function erasePosthogPerson(
  cfg: PosthogQueryConfig | null,
  distinctId: string,
): Promise<PosthogEraseResult> {
  const lookup = await lookupPosthogPersons(cfg, distinctId);
  if (lookup.status !== "found") return { ...lookup, status: lookup.status };
  // cfg is non-null here: `found` needs a request.
  const config = cfg as PosthogQueryConfig;
  const { personIds } = lookup;
  try {
    for (const personId of personIds) {
      const res = await request(
        config,
        `${encodeURIComponent(personId)}/?delete_events=true`,
        { method: "DELETE" },
      );
      if (isForbidden(res.status)) {
        return { status: "skipped_forbidden", personIds, httpStatus: res.status };
      }
      // 404: gone between the lookup and the delete (a parallel run, the
      // dashboard) — the end state holds, which is all idempotency asks.
      if (!res.ok && res.status !== 404) {
        return { status: "failed", personIds, httpStatus: res.status };
      }
    }
    return { status: "deleted", personIds };
  } catch (err) {
    return { status: "failed", personIds, error: describeError(err) };
  }
}
