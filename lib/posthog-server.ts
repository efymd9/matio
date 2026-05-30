import "server-only";
import { PostHog } from "posthog-node";

// Server-side PostHog (the bottom-of-funnel conversion fired from the Stripe
// webhook). Best-effort like lib/meta-capi.ts: DEGRADES to a no-op when
// unconfigured and NEVER throws, so a missing key or a PostHog outage can't
// fail subscription processing or roll back the webhook's idempotency claim.
//
// Uses captureImmediate() — posthog-node's send-and-await method built for
// short-lived serverless functions, where the default buffered/interval flush
// would lose events when the function freezes. The client is a lazy global
// (mirrors lib/meta-capi.ts's __metaCapiClient) so Fluid Compute reuses it
// across invocations; we never use the buffered queue, so no shutdown/flush
// dance is needed. requestTimeout bounds the network call like CAPI's 3s cap.

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
const POSTHOG_TIMEOUT_MS = 3_000;

declare global {
  var __posthogServerClient: PostHog | undefined;
}

function getPostHogServer(): PostHog | null {
  if (globalThis.__posthogServerClient) return globalThis.__posthogServerClient;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const client = new PostHog(key, {
    host: POSTHOG_HOST,
    requestTimeout: POSTHOG_TIMEOUT_MS,
  });
  globalThis.__posthogServerClient = client;
  return client;
}

// Fire one server-side event. NEVER throws — returns a result the caller can
// log. `skipped` means PostHog isn't configured (local dev / no key). The
// captureImmediate call is bounded by requestTimeout.
export async function captureServerEvent(params: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const client = getPostHogServer();
  if (!client) return { ok: false, skipped: true };
  try {
    await client.captureImmediate({
      distinctId: params.distinctId,
      event: params.event,
      properties: params.properties,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "PostHog capture failed",
    };
  }
}
