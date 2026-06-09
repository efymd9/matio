import "server-only";
import type { NextRequest } from "next/server";
import { normalizeUtm, normalizeUtmSource } from "@/lib/utm";

// Per-campaign attribution. Captured from UTM query params on landing,
// persisted at each funnel milestone (trial_sessions on first play, users
// on first authenticated touch, subscriptions at checkout) so the admin
// dashboard can slice every existing metric by campaign without leaving
// the stack.
//
// Two cookies, both compact JSON:
//   attribution_first — set once, 90-day max-age (write-if-absent). Tells
//                       us which campaign opened the relationship. Best
//                       signal for "is this awareness channel working?"
//                       since most paid conversions happen days after
//                       the first visit (60s trial → leave → come back).
//   attribution_last  — overwrite on every UTM landing, 30-day max-age.
//                       Matches what Meta/Google report as conversion
//                       attribution and lets us reconcile with platform
//                       dashboards.
//
// Only utm_source / utm_medium / utm_campaign are stored. utm_term and
// utm_content are rarely used for cohort analytics and skipping them
// keeps cookies small (200 bytes) and the schema lean (3 cols × 2
// touches per table).

export const ATTRIBUTION_FIRST_COOKIE = "attribution_first";
export const ATTRIBUTION_LAST_COOKIE = "attribution_last";

// 90d first-touch: long enough that a TikTok-driven visitor who trials
// then comes back two months later still attributes correctly. 30d
// last-touch: matches typical ad-platform attribution windows.
export const ATTRIBUTION_FIRST_MAX_AGE = 60 * 60 * 24 * 90;
export const ATTRIBUTION_LAST_MAX_AGE = 60 * 60 * 24 * 30;

// Cap each field at this many chars before persisting — defensive against
// pathological URLs (some ad networks dump entire JSON blobs into utm_*).
const FIELD_MAX_LEN = 100;

export type AttributionPayload = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
};

export const EMPTY_ATTRIBUTION: AttributionPayload = {
  source: null,
  medium: null,
  campaign: null,
};

function clean(value: string | null | undefined): string | null {
  // normalizeUtm lowercases + strips non-[a-z0-9_-] so a stray char or case
  // drift can't fragment a campaign across the attribution columns / Stripe
  // metadata (matches the PostHog funnel breakdown). FIELD_MAX_LEN still caps
  // pathological ad-network URLs that dump JSON blobs into utm_*.
  const normalized = normalizeUtm(value);
  if (!normalized) return null;
  return normalized.length > FIELD_MAX_LEN
    ? normalized.slice(0, FIELD_MAX_LEN)
    : normalized;
}

// Same as clean() but canonicalizes the value as a utm_SOURCE (facebook/meta →
// fb, instagram → ig) so platform spelling variants don't fragment source
// reporting. Source-only — medium and campaign keep clean().
function cleanSource(value: string | null | undefined): string | null {
  const normalized = normalizeUtmSource(value);
  if (!normalized) return null;
  return normalized.length > FIELD_MAX_LEN
    ? normalized.slice(0, FIELD_MAX_LEN)
    : normalized;
}

export function hasAnyField(p: AttributionPayload): boolean {
  return p.source !== null || p.medium !== null || p.campaign !== null;
}

export function readAttributionFromSearchParams(
  params: URLSearchParams,
): AttributionPayload {
  return {
    source: cleanSource(params.get("utm_source")),
    medium: clean(params.get("utm_medium")),
    campaign: clean(params.get("utm_campaign")),
  };
}

export function serializeAttribution(p: AttributionPayload): string {
  // Compact key names so the cookie stays small. Null fields are omitted
  // entirely so {"s":"google"} is valid instead of forcing nulls in.
  const out: Record<string, string> = {};
  if (p.source) out.s = p.source;
  if (p.medium) out.m = p.medium;
  if (p.campaign) out.c = p.campaign;
  return JSON.stringify(out);
}

export function parseAttributionCookie(
  raw: string | undefined,
): AttributionPayload {
  if (!raw) return EMPTY_ATTRIBUTION;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      source: cleanSource(typeof parsed.s === "string" ? parsed.s : null),
      medium: clean(typeof parsed.m === "string" ? parsed.m : null),
      campaign: clean(typeof parsed.c === "string" ? parsed.c : null),
    };
  } catch {
    return EMPTY_ATTRIBUTION;
  }
}

// Read both cookies from a NextRequest (used by proxy.ts which has access
// to req.cookies). Page/route handlers running in app/ use the cookies()
// from next/headers via readAttributionCookies().
export function readAttributionCookiesFromRequest(req: NextRequest): {
  first: AttributionPayload;
  last: AttributionPayload;
} {
  return {
    first: parseAttributionCookie(req.cookies.get(ATTRIBUTION_FIRST_COOKIE)?.value),
    last: parseAttributionCookie(req.cookies.get(ATTRIBUTION_LAST_COOKIE)?.value),
  };
}

// Read both cookies via next/headers cookies() inside server components,
// route handlers, and server actions. Returns the same shape so callers
// don't need to branch on context.
export async function readAttributionCookies(): Promise<{
  first: AttributionPayload;
  last: AttributionPayload;
}> {
  const { cookies } = await import("next/headers");
  const store = await cookies();
  return {
    first: parseAttributionCookie(store.get(ATTRIBUTION_FIRST_COOKIE)?.value),
    last: parseAttributionCookie(store.get(ATTRIBUTION_LAST_COOKIE)?.value),
  };
}

// Map an AttributionPayload to the DB column names used across tables.
// Tables follow the same naming convention (attribution_first_source,
// attribution_last_source, etc.) so this helper centralises the mapping
// and a future rename only needs to happen here.
export function toFirstColumns(p: AttributionPayload) {
  return {
    attributionFirstSource: p.source,
    attributionFirstMedium: p.medium,
    attributionFirstCampaign: p.campaign,
  };
}

export function toLastColumns(p: AttributionPayload) {
  return {
    attributionLastSource: p.source,
    attributionLastMedium: p.medium,
    attributionLastCampaign: p.campaign,
  };
}

// Stripe metadata is string-only and capped at 50 keys / 500 chars per
// value. We flatten attribution into six keys so the webhook reading them
// back can keep the same shape it would have read from cookies.
export const STRIPE_METADATA_KEYS = {
  firstSource: "attr_first_source",
  firstMedium: "attr_first_medium",
  firstCampaign: "attr_first_campaign",
  lastSource: "attr_last_source",
  lastMedium: "attr_last_medium",
  lastCampaign: "attr_last_campaign",
} as const;

export function toStripeMetadata(
  first: AttributionPayload,
  last: AttributionPayload,
): Record<string, string> {
  const meta: Record<string, string> = {};
  if (first.source) meta[STRIPE_METADATA_KEYS.firstSource] = first.source;
  if (first.medium) meta[STRIPE_METADATA_KEYS.firstMedium] = first.medium;
  if (first.campaign) meta[STRIPE_METADATA_KEYS.firstCampaign] = first.campaign;
  if (last.source) meta[STRIPE_METADATA_KEYS.lastSource] = last.source;
  if (last.medium) meta[STRIPE_METADATA_KEYS.lastMedium] = last.medium;
  if (last.campaign) meta[STRIPE_METADATA_KEYS.lastCampaign] = last.campaign;
  return meta;
}

export function fromStripeMetadata(
  meta: Record<string, string> | null | undefined,
): { first: AttributionPayload; last: AttributionPayload } {
  const m = meta ?? {};
  return {
    first: {
      source: cleanSource(m[STRIPE_METADATA_KEYS.firstSource]),
      medium: clean(m[STRIPE_METADATA_KEYS.firstMedium]),
      campaign: clean(m[STRIPE_METADATA_KEYS.firstCampaign]),
    },
    last: {
      source: cleanSource(m[STRIPE_METADATA_KEYS.lastSource]),
      medium: clean(m[STRIPE_METADATA_KEYS.lastMedium]),
      campaign: clean(m[STRIPE_METADATA_KEYS.lastCampaign]),
    },
  };
}

// Persists the current user's UTM cookies onto their users row. Designed
// to be cheap and idempotent:
//   - No DB query if neither attribution cookie has any field set.
//   - First-touch columns only update when currently NULL (the WHERE
//     clause does the gate — safer than a select-then-update race).
//   - Last-touch columns overwrite on every call where the cookie
//     carries data.
// Called from /subscribe page render (alongside linkTrialSessionsToCurrentUser)
// so paywall-driven signups get attributed at the moment the funnel
// connects to a real user id. Safe to call from other authenticated
// touchpoints in the future.
export async function applyUserAttribution(userId: string): Promise<void> {
  const payload = await readAttributionCookies();
  await applyUserAttributionPayload(userId, payload);
}

// Same write semantics as applyUserAttribution, but takes the payload
// directly instead of reading request cookies — for contexts where the
// attribution arrives out-of-band (the guest-checkout claim reads it back
// from Stripe subscription metadata inside the cookie-less webhook).
export async function applyUserAttributionPayload(
  userId: string,
  { first, last }: { first: AttributionPayload; last: AttributionPayload },
): Promise<void> {
  if (!hasAnyField(first) && !hasAnyField(last)) return;

  const { db } = await import("@/db");
  const { users } = await import("@/db/schema");
  const { and, eq, isNull, sql } = await import("drizzle-orm");

  // First-touch: set the three columns iff all three are still NULL (so
  // we don't half-overwrite an earlier attribution where, e.g., only
  // utm_source was set). Skip when cookie has no first-touch fields —
  // would otherwise no-op-write NULLs.
  if (hasAnyField(first)) {
    await db
      .update(users)
      .set(toFirstColumns(first))
      .where(
        and(
          eq(users.id, userId),
          isNull(users.attributionFirstSource),
          isNull(users.attributionFirstMedium),
          isNull(users.attributionFirstCampaign),
        ),
      );
  }

  // Last-touch: overwrite each column only when the new value is
  // non-null. COALESCE preserves existing data when the new cookie is
  // partial (e.g. utm_campaign set but utm_medium absent on this
  // landing). Without this, a campaign URL that omitted utm_medium
  // would null out the existing utm_medium captured from a prior URL.
  if (hasAnyField(last)) {
    await db
      .update(users)
      .set({
        attributionLastSource:
          last.source !== null ? last.source : sql`${users.attributionLastSource}`,
        attributionLastMedium:
          last.medium !== null ? last.medium : sql`${users.attributionLastMedium}`,
        attributionLastCampaign:
          last.campaign !== null ? last.campaign : sql`${users.attributionLastCampaign}`,
      })
      .where(eq(users.id, userId));
  }
}
