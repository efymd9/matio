import "server-only";
import { PostHog } from "posthog-node";

// Server-side PostHog (the bottom-of-funnel conversion fired from the Stripe
// webhook). Best-effort like lib/meta-capi.ts: DEGRADES to a no-op when
// unconfigured and NEVER throws, so a missing key or a PostHog outage can't
// fail subscription processing or roll back the webhook's idempotency claim.
//
// posthog-node v5 API notes (verified against installed types):
// - flushAt / flushInterval do NOT exist in v5 — removed.
// - requestTimeout IS valid (bounds feature-flag poller + request aborts).
// - shutdown() on IPostHog is void (non-async). The concrete _shutdown() is
//   async and flushes pending events — we await that to ensure the event is
//   sent before the serverless function freezes.
// - captureImmediate() is available as an async alternative, but
//   capture() + _shutdown() follows the plan's intent of an explicit flush
//   before return.

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
const POSTHOG_TIMEOUT_MS = 3_000;

export async function captureServerEvent(params: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return { ok: false, skipped: true };

  const client = new PostHog(key, {
    host: POSTHOG_HOST,
    requestTimeout: POSTHOG_TIMEOUT_MS,
  });
  try {
    client.capture({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    });
    await client._shutdown();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "PostHog capture failed",
    };
  }
}
