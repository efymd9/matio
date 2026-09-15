import "server-only";
import type { PosthogQueryConfig } from "@/lib/posthog-hogql";

// The ONE place the app reads the PostHog personal API key. Server-only on
// purpose — the key never leaves the server bundle — and split out of
// lib/posthog-query.ts so a consumer that only needs the credentials (the
// Clerk webhook's account erasure, lib/erase-user.ts) does not drag the
// admin analytics layer into its module graph. lib/posthog-query.ts
// re-exports it for the dashboard code that always imported it from there.
//
// Requires a PostHog **personal API key** — the public phc_… project key
// (NEXT_PUBLIC_POSTHOG_KEY) can neither run queries nor delete persons —
// plus the numeric project id. Scopes: query:read for the admin panels,
// person:read + person:write for the erasure (docs/services.md).
// Unconfigured → null; every consumer degrades (a connect hint, a
// `skipped_unconfigured` status), never a throw.
export function getPosthogQueryConfig(): PosthogQueryConfig | null {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!key || !projectId) return null;
  return { key, projectId };
}
