// Which origins may present a Clerk session token to THIS deployment — the
// `authorizedParties` allowlist `clerkMiddleware` checks the token's `azp`
// (authorized party = the browser Origin the token was minted for) against.
// Without it a token minted for any other origin on the same Clerk instance
// (a future subdomain, another app) is accepted here as-is (#100).
//
// Universal and PURE: no `next/headers`, no `process.env` — the environment
// and the request arrive as arguments, so a test states what it tests. Runs
// inside proxy.ts, i.e. on every request: nothing here allocates beyond the
// one-time list.

import type { EnvLike } from "@/lib/observability";
import { SITE_URL } from "@/lib/seo";

/**
 * The deployment's own stable origins, or `undefined` when they cannot be
 * enumerated — and `undefined` means "verify as before, no `azp` check",
 * never "nobody is allowed".
 *
 * The list applies only on a Vercel PRODUCTION deployment (`VERCEL_ENV`),
 * which is the only kind with a stable address: previews are minted per
 * commit (`matio-git-<branch>-….vercel.app`) and cannot be listed — a fixed
 * list would sign the reviewer out of every preview — and localhost is
 * nobody's party. The staging bench qualifies: it is the production
 * deployment of its own Vercel project, so `VERCEL_ENV` is `production`
 * there too. `APP_ENV` (the stage marker) is deliberately NOT consulted: the
 * question is not "which stage" but "is the origin stable".
 *
 * Origins come from the environment: `VERCEL_PROJECT_PRODUCTION_URL` (set by
 * Vercel on every deployment: the project's shortest production domain, bare
 * hostname — `matio.tv` on prod, `matio-staging.vercel.app` on the bench)
 * plus `NEXT_PUBLIC_APP_URL` when it is an https origin. A custom domain is
 * listed with its apex AND `www.` twin (prod: `https://matio.tv` +
 * `https://www.matio.tv`); a `*.vercel.app` host has no such twin. Garbage
 * in either variable is skipped.
 *
 * The canonical site (`SITE_URL`, hard-pinned) is ALWAYS in the list. That
 * is the safety net for a variable that is valid but wrong — say the system
 * variable naming the legacy `matio-ten.vercel.app` alias instead of the
 * apex: `TokenInvalidAuthorizedParties` is not a handshake reason in
 * `@clerk/backend`, so a list without the apex would sign EVERY prod request
 * out (the SignupWall for everyone under REQUIRE_SIGNUP, a redirect loop on
 * /admin). On the bench the apex is a harmless extra: a token carrying a
 * matio.tv `azp` is signed by the other Clerk instance and fails there.
 */
export function resolveAuthorizedParties(env: EnvLike): string[] | undefined {
  if (env.VERCEL_ENV !== "production") return undefined;

  const origins = new Set<string>();
  for (const candidate of [
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.NEXT_PUBLIC_APP_URL,
    SITE_URL,
  ]) {
    const url = parseHttps(candidate);
    if (!url) continue;
    for (const origin of withWwwTwin(url)) origins.add(origin);
  }
  return [...origins];
}

/** `https://host[:port]/…` or a bare `host` → a URL; anything else → null. */
function parseHttps(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const VERCEL_HOST_SUFFIX = ".vercel.app";

function withWwwTwin(url: URL): string[] {
  if (url.hostname.endsWith(VERCEL_HOST_SUFFIX)) return [url.origin];
  const apex = url.hostname.replace(/^www\./, "");
  return [withHostname(url, apex), withHostname(url, `www.${apex}`)];
}

function withHostname(url: URL, hostname: string): string {
  const twin = new URL(url.origin);
  twin.hostname = hostname;
  return twin.origin;
}

/** The only surface the native app talks to; the exemption below is scoped to it. */
const NATIVE_API_PREFIX = "/api/v1/";

/**
 * The allowlist to verify ONE request with. The deploy-time list applies to
 * every request except one case: a `/api/v1/*` request whose Authorization
 * header carries a token with no `azp` claim at all — a native session token
 * (`@clerk/expo`), minted with no browser Origin. Everywhere else (`/`,
 * `/watch`, `/admin`, the web's own `/api/*`) the list always applies.
 *
 * Why the exemption exists: `@clerk/backend` ≥3.x rejects a token WITHOUT
 * `azp` outright when `authorizedParties` is set (`assertAuthorizedPartiesClaim`
 * in 3.17.1; the 3.4.6 the plan was written against skipped the check), so a
 * plain list would sign the mobile app out of `/api/v1`. Clerk's own
 * verification guidance is "if the `azp` claim doesn't exist, skip this
 * step" — this is that rule, applied where the SDK no longer applies it.
 *
 * The token peeked at MUST be the token Clerk will verify. Clerk reads the
 * header on its own terms (`parseAuthorizationHeader`, mirrored below, byte
 * for byte) and, when it finds a header token, verifies THAT and never looks
 * at the cookie — so withholding the list on a header token can never relax
 * the check on a cookie session. A looser reading (a case-insensitive
 * `bearer`, say) would open exactly that hole: Clerk sees no header token,
 * verifies the cookie, and we would have withheld the list for it.
 *
 * Peeking at the payload without verifying it is safe: the peek never grants
 * anything, it only decides whether to ADD the `azp` constraint. The
 * signature, expiry and issuer checks run on the token either way, so a
 * forged or stripped payload fails there. A browser-minted token (which
 * always carries `azp`) replayed as a `Bearer` is still held to the list.
 */
export function authorizedPartiesForRequest(
  parties: string[] | undefined,
  authorization: string | null | undefined,
  pathname: string,
): string[] | undefined {
  if (!parties) return undefined;
  if (!pathname.startsWith(NATIVE_API_PREFIX)) return parties;
  const token = clerkTokenInHeader(authorization);
  if (token !== undefined && !jwtCarriesAzp(token)) return undefined;
  return parties;
}

/**
 * `@clerk/backend` 3.17.1 `parseAuthorizationHeader`, verbatim: no header →
 * nothing; no space → the whole value is the token; `Bearer <token>` (exact
 * case) → the token; any other scheme (`Basic`, `bearer`, …) → nothing, and
 * Clerk then authenticates from the cookie.
 */
function clerkTokenInHeader(
  authorization: string | null | undefined,
): string | undefined {
  if (!authorization) return undefined;
  const [scheme, token] = authorization.split(" ", 2);
  if (!token) return scheme;
  if (scheme === "Bearer") return token;
  return undefined;
}

function jwtCarriesAzp(token: string): boolean {
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(
      atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return (
      typeof claims === "object" &&
      claims !== null &&
      typeof (claims as { azp?: unknown }).azp === "string" &&
      (claims as { azp: string }).azp.length > 0
    );
  } catch {
    return false;
  }
}
