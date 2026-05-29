import "server-only";
import crypto from "node:crypto";

// Meta Conversions API (server-side events). A plain fetch to the Graph API —
// no SDK, since CLAUDE.md forbids adding dependencies without asking. Mirrors
// the lazy-client shape of lib/stripe.ts / lib/mux.ts, but DEGRADES to a no-op
// when the env isn't configured instead of throwing: CAPI is best-effort
// analytics fired from the money path (the Stripe webhook), and a missing
// marketing secret must never fail subscription processing.

// Bump when Meta deprecates the version (~2yr cadence). Overridable via env.
const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION ?? "v21.0";
// Hard cap so a slow / blocked Graph endpoint can't stall a webhook response.
const CAPI_TIMEOUT_MS = 3_000;

type MetaClient = {
  pixelId: string;
  accessToken: string;
  testEventCode: string | undefined;
  endpoint: string;
};

declare global {
  var __metaCapiClient: MetaClient | undefined;
}

function getMetaCapi(): MetaClient | null {
  if (globalThis.__metaCapiClient) return globalThis.__metaCapiClient;
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return null;
  const client: MetaClient = {
    pixelId,
    accessToken,
    // Only set while testing in the Events Manager "Test events" tab.
    testEventCode: process.env.META_CAPI_TEST_EVENT_CODE || undefined,
    endpoint: `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events`,
  };
  globalThis.__metaCapiClient = client;
  return client;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Meta Advanced Matching: PII is SHA-256 hashed (lowercased + trimmed) before
// it leaves our server. We never send a raw email.
export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized ? sha256(normalized) : null;
}

export function hashExternalId(id: string | null | undefined): string | null {
  if (!id) return null;
  const trimmed = id.trim();
  return trimmed ? sha256(trimmed) : null;
}

export type CapiUserData = {
  email?: string | null; // raw — hashed here
  externalId?: string | null; // raw (Clerk user id) — hashed here
  fbp?: string | null;
  fbc?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

export type CapiEvent = {
  eventName: string;
  eventId?: string; // stable id for browser↔server / retry de-duplication
  eventSourceUrl?: string;
  actionSource?: "website" | "system_generated";
  user: CapiUserData;
  customData?: Record<string, unknown>;
};

function buildUserData(u: CapiUserData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const em = hashEmail(u.email);
  if (em) out.em = [em];
  const ext = hashExternalId(u.externalId);
  if (ext) out.external_id = [ext];
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  // "unknown" is lib/trial.ts's missing-IP sentinel — never send it as a match
  // signal (it would bucket every unidentifiable request into one bad match).
  if (u.clientIpAddress && u.clientIpAddress !== "unknown") {
    out.client_ip_address = u.clientIpAddress;
  }
  if (u.clientUserAgent) out.client_user_agent = u.clientUserAgent;
  return out;
}

// Fire one or more CAPI events. NEVER throws — returns a result the caller can
// log. `skipped` means CAPI isn't configured (local dev / no token). Bounded
// by CAPI_TIMEOUT_MS.
export async function sendCapiEvents(
  events: CapiEvent[],
  eventTimeSeconds?: number,
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const client = getMetaCapi();
  if (!client) return { ok: false, skipped: true };
  if (events.length === 0) return { ok: true };

  const eventTime = eventTimeSeconds ?? Math.floor(Date.now() / 1000);
  const data = events.map((e) => {
    const event: Record<string, unknown> = {
      event_name: e.eventName,
      event_time: eventTime,
      action_source: e.actionSource ?? "website",
      user_data: buildUserData(e.user),
    };
    if (e.eventId) event.event_id = e.eventId;
    if (e.eventSourceUrl) event.event_source_url = e.eventSourceUrl;
    if (e.customData && Object.keys(e.customData).length > 0) {
      event.custom_data = e.customData;
    }
    return event;
  });

  const body: Record<string, unknown> = { data };
  if (client.testEventCode) body.test_event_code = client.testEventCode;

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), CAPI_TIMEOUT_MS)
    : null;
  try {
    const res = await fetch(
      `${client.endpoint}?access_token=${encodeURIComponent(client.accessToken)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      },
    );
    if (!res.ok) {
      let detail = "";
      try {
        // Short slice for logs only. The access token is in the URL, not the
        // body or this response — it is never logged.
        detail = (await res.text()).slice(0, 300);
      } catch {
        // ignore body read failures
      }
      return { ok: false, error: `Meta CAPI ${res.status}: ${detail}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Meta CAPI request failed",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
