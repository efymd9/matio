// Password lock for the staging bench — the decision half, kept pure so it can
// be tested without a request pipeline. `proxy.ts` owns the wiring.
//
// WHY IN THE APP AND NOT IN THE PANEL: Vercel Authentication does close a
// project's URLs, but covering the project's MAIN alias needs
// `deploymentType: "all"`, which the current plan refuses
// (`428 Vercel Authentication is not available on your plan for production
// deployments`). The free tier closes preview URLs only, and the bench IS a
// production deployment of its own project. So the lock lives here: one env
// var (`STAGING_LOCK_PASSWORD`) turns the whole origin into HTTP Basic Auth.
//
// The module deliberately never reads the environment itself — the password
// arrives as an argument. Nothing here can leak a secret into a bundle, and
// the tests state the password they are testing with.
//
// Basic Auth resends the password on every request and offers no per-person
// revocation; that is an accepted trade-off for a bench that holds seeded data
// only (no real accounts, no viewing history, no email addresses — see the
// staging rules in the /devops skill). Timing-safe comparison is deliberately
// NOT used: `proxy.ts` runs on every request, and a timing oracle against
// synthetic data is not our threat model.

/** Realm shown in the browser's password prompt. */
export const STAGING_LOCK_REALM = "matio staging";

/** Ready-made `WWW-Authenticate` value for the 401 challenge. */
export const STAGING_LOCK_CHALLENGE = `Basic realm="${STAGING_LOCK_REALM}"`;

/** Robots header name + value stamped on every locked-origin response. */
export const NOINDEX_HEADER = "X-Robots-Tag";
export const NOINDEX_VALUE = "noindex, nofollow";

// Paths that answer WITHOUT the password. Uptime pings and the release smoke
// test must not carry credentials, and /api/healthz returns nothing but the
// version, commit and environment of the running build. The retention cron
// is open for the same reason: Vercel Cron calls it with its own
// `Authorization: Bearer <CRON_SECRET>` (a Basic challenge would just 401 the
// platform every night), and the route refuses anything but that bearer.
// Paths the lock deliberately leaves open. Every one of them is a MACHINE
// caller that cannot send a browser's Basic Auth header and authenticates
// itself some other way: the uptime probe (nothing to protect), the
// platform cron (Bearer CRON_SECRET), and the three vendor webhooks, each
// of which verifies its own signature before touching anything (Stripe
// signature, Svix for Clerk, Mux signature). Leaving the webhooks locked
// meant the bench answered 401 to Stripe and no purchase could ever be
// rehearsed — found while preparing #153.
const OPEN_PATHS = new Set([
  "/api/healthz",
  "/api/cron/retention",
  "/api/webhooks/stripe",
  "/api/webhooks/clerk",
  "/api/webhooks/mux",
]);

// Well-known URIs (RFC 8615) are machine-fetched by third parties that can
// never send a browser's Basic credential, and every one of them is public by
// definition — that is the entire point of the namespace. Left open as a
// PREFIX so a future one does not have to be discovered the hard way.
//
// The concrete motivation is payment-wallet verification (#210): Stripe's
// modern payment-method-domain registration needs no hosted file, but Apple's
// own re-verification of a registered domain still re-fetches
// /.well-known/apple-developer-merchantid-domain-association. A 401 there
// surfaces as "Apple Pay just stopped working" with no error anywhere, which
// is the most expensive kind of failure to diagnose. Nothing under this prefix
// is generated from user data.
const OPEN_PREFIXES = ["/.well-known/"];

export type StagingLockVerdict = "allow" | "challenge";

/** True for the handful of paths the lock deliberately leaves open. */
export function isStagingLockOpenPath(pathname: string): boolean {
  if (OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // A trailing slash is the same resource; nothing else is normalised, because
  // the pathname arrives already decoded and normalised from `req.nextUrl`.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return OPEN_PATHS.has(normalized);
}

// Base64 → UTF-8 string. `atob` alone yields one char per BYTE, so a non-ASCII
// password would never match what the browser sent; the TextDecoder pass makes
// the comparison correct for any password the owner picks.
function decodeBase64(value: string): string | null {
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Does an `Authorization` header carry our password? The username is ignored
 * on purpose — there is one shared credential and browsers insist on asking
 * for a name anyway.
 */
export function hasStagingLockCredentials(
  authorization: string | null | undefined,
  password: string,
): boolean {
  if (!authorization) return false;
  const match = /^basic\s+(\S+)$/i.exec(authorization.trim());
  if (!match) return false;
  const decoded = decodeBase64(match[1]);
  if (decoded === null) return false;
  // The password may itself contain ':', so split on the FIRST one only
  // (RFC 7617: the user-id is the part before it and cannot contain a colon).
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;
  return decoded.slice(separator + 1) === password;
}

/**
 * The whole decision for one request, given a lock that is known to be ON.
 * Whether it is on at all (env var present and non-empty) stays in `proxy.ts`,
 * so a bench-less request pays exactly one environment read.
 */
export function evaluateStagingLock(
  password: string,
  pathname: string,
  authorization: string | null | undefined,
): StagingLockVerdict {
  if (isStagingLockOpenPath(pathname)) return "allow";
  return hasStagingLockCredentials(authorization, password) ? "allow" : "challenge";
}

/**
 * The 401 that makes the browser ask for the password. Carries the robots
 * header too: a 401 is not indexable anyway, but the header costs nothing and
 * does not depend on a crawler behaving.
 */
export function stagingLockChallenge(): Response {
  return new Response("Staging bench — password required.\n", {
    status: 401,
    headers: {
      "WWW-Authenticate": STAGING_LOCK_CHALLENGE,
      [NOINDEX_HEADER]: NOINDEX_VALUE,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
