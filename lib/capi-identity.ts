import "server-only";

// Per-conversion Meta Conversions API identity: the browser-set _fbp / _fbc
// cookies plus the client IP and user-agent. The Stripe webhook that fires the
// Purchase event has NO browser request context, so — exactly like the UTM
// attribution pipeline in lib/attribution.ts — we snapshot these at checkout
// creation and ferry them through Stripe subscription_data.metadata, then read
// them back webhook-side via fromCapiMetadata().
//
// Capture is gated on marketing consent at the call site (startCheckout). The
// `capi_consent` sentinel below is the signal the context-less webhook reads
// to decide whether CAPI may fire at all — independent of whether any match
// field happened to be present.

export const FBP_COOKIE = "_fbp";
export const FBC_COOKIE = "_fbc";

// _fbc encodes a Meta click id: fb.<subdomainIndex>.<clickTimeMs>.<fbclid>.
// Pure + caller-supplied clock so proxy.ts (middleware) can derive it without
// importing next/headers. Subdomain index is 1 for a top-level (apex) domain.
export function buildFbc(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

export type CapiIdentity = {
  fbp: string | null;
  fbc: string | null;
  ip: string | null;
  ua: string | null;
};

export const EMPTY_CAPI_IDENTITY: CapiIdentity = {
  fbp: null,
  fbc: null,
  ip: null,
  ua: null,
};

// Stripe caps metadata values at 500 chars; leave headroom for the UA.
const UA_MAX_LEN = 350;

function clean(v: string | null | undefined, max = 200): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

// Read identity from the current server request (server action / route
// handler) via next/headers. We trust ONLY x-vercel-forwarded-for for the
// client IP — the same header lib/trial.ts uses — because the standard
// x-forwarded-for is attacker-appendable at the Vercel edge.
export async function readCapiIdentity(): Promise<CapiIdentity> {
  const { cookies, headers } = await import("next/headers");
  const store = await cookies();
  const h = await headers();
  const ipRaw = h.get("x-vercel-forwarded-for")?.trim();
  return {
    fbp: clean(store.get(FBP_COOKIE)?.value),
    fbc: clean(store.get(FBC_COOKIE)?.value),
    ip: ipRaw && ipRaw !== "unknown" ? ipRaw : null,
    ua: clean(h.get("user-agent"), UA_MAX_LEN),
  };
}

export const CAPI_METADATA_KEYS = {
  consent: "capi_consent",
  fbp: "capi_fbp",
  fbc: "capi_fbc",
  ip: "capi_ip",
  ua: "capi_ua",
} as const;

// Flatten identity into Stripe metadata. Always includes the consent sentinel
// (the caller only calls this when consent is present) so the webhook can tell
// "consented, identity happened to be empty" from "no consent at all".
export function toCapiMetadata(identity: CapiIdentity): Record<string, string> {
  const meta: Record<string, string> = { [CAPI_METADATA_KEYS.consent]: "1" };
  if (identity.fbp) meta[CAPI_METADATA_KEYS.fbp] = identity.fbp;
  if (identity.fbc) meta[CAPI_METADATA_KEYS.fbc] = identity.fbc;
  if (identity.ip) meta[CAPI_METADATA_KEYS.ip] = identity.ip;
  if (identity.ua) meta[CAPI_METADATA_KEYS.ua] = identity.ua;
  return meta;
}

export function metadataHasCapiConsent(
  meta: Record<string, string> | null | undefined,
): boolean {
  return (meta ?? {})[CAPI_METADATA_KEYS.consent] === "1";
}

export function fromCapiMetadata(
  meta: Record<string, string> | null | undefined,
): CapiIdentity {
  const m = meta ?? {};
  return {
    fbp: clean(m[CAPI_METADATA_KEYS.fbp]),
    fbc: clean(m[CAPI_METADATA_KEYS.fbc]),
    ip: clean(m[CAPI_METADATA_KEYS.ip]),
    ua: clean(m[CAPI_METADATA_KEYS.ua], UA_MAX_LEN),
  };
}
