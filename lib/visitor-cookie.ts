// First-party audience-measurement cookie (consent-exempt) — constants only.
// Universal module: imported by proxy.ts (middleware bundle — keep it free of
// db / next-headers weight) and by the server-side helpers in lib/visitor.ts.
//
// The value is a server-minted random UUID with no meaning outside our DB.
// httpOnly — client code never reads it; the /api/t beacon relies on the
// browser attaching it automatically.
export const VISITOR_COOKIE = "matio_aid";

// 13 months, per CNIL's exempt-audience-measurement guidance. Deliberately
// NOT refreshed on later visits (set once, expires 13 months after the
// first visit) — extending on every visit would make it a rolling
// forever-cookie, which the exemption doesn't cover.
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 395;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The beacon/link paths write the cookie value into a uuid DB column —
// reject anything that isn't shaped like our own minting before it reaches
// a query (a forged cookie would otherwise throw on cast).
export function isValidAid(value: string | undefined | null): value is string {
  return !!value && UUID_RE.test(value);
}
