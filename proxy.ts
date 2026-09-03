import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse, userAgent } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  ATTRIBUTION_FIRST_COOKIE,
  ATTRIBUTION_FIRST_MAX_AGE,
  ATTRIBUTION_LAST_COOKIE,
  ATTRIBUTION_LAST_MAX_AGE,
  hasAnyField,
  readAttributionFromSearchParams,
  serializeAttribution,
} from "@/lib/attribution";
import { FBC_COOKIE, buildFbc } from "@/lib/capi-identity";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  CONSENT_VERSION,
  marketingConsentRequired,
  parseConsent,
  serializeConsent,
} from "@/lib/cookie-consent";
import { paymentsEnabled } from "@/lib/free-mode";
import { negotiateLocale } from "@/lib/i18n/negotiate";
import {
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  URL_LOCALE_HEADER,
} from "@/lib/i18n/shared";
import {
  isLocalizablePath,
  LEGACY_ALIAS_HOST,
  localizedPath,
  SITE_URL,
  stripLocalePrefix,
} from "@/lib/seo";
import {
  evaluateStagingLock,
  NOINDEX_HEADER,
  NOINDEX_VALUE,
  stagingLockChallenge,
} from "@/lib/staging-lock";
import { VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from "@/lib/visitor-cookie";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);
const isAuthRoute = createRouteMatcher(["/subscribe(.*)"]);

// The trial_session cookie used to be minted here on any /watch/* hit,
// which (a) leaked cookies for unpublished/draft slugs and (b) started the
// 60-second clock on page load before the user ever pressed play. Cookie
// minting now happens in /api/playback-token, where the show is verified
// published+ready and the trial row is created at the moment of play.

// Cache for the per-user role lookup. Without it, every /admin/* request —
// including RSC prefetches and the matcher-caught fan-out — translates 1:1
// into a Neon roundtrip; a single signed-in user can saturate the pooled
// connection by spamming admin URLs. TTL kept short so role changes
// (promote/demote) propagate quickly. The cache lives in module scope and
// is process-local; Vercel Fluid Compute reuses instances across requests,
// so the amortisation actually happens.
const ROLE_CACHE_TTL_MS = 5_000;
const roleCache = new Map<string, { role: string | null; expiresAt: number }>();

async function getUserRoleCached(userId: string): Promise<string | null> {
  const now = Date.now();
  const hit = roleCache.get(userId);
  if (hit && hit.expiresAt > now) return hit.role;
  const [row] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const role = row?.role ?? null;
  roleCache.set(userId, { role, expiresAt: now + ROLE_CACHE_TTL_MS });
  return role;
}

// Returns a NextResponse with marketing cookies set, or null if there's
// nothing to do. Handles:
//   - GEO-AWARE consent default. An opt-in banner is legally required only in
//     the EU/EEA/UK/CH (ePrivacy / PECR / Spain LSSI), so there we persist
//     nothing until the visitor accepts. Everywhere else (the Americas, etc.)
//     we DEFAULT marketing consent ON: we write the cookie_consent cookie
//     ourselves AND forward it on the request, so the SAME render hides the
//     banner and loads the pixel — unless the visitor already made an explicit
//     choice (incl. opting out via the footer). Geo comes from Vercel's
//     `x-vercel-ip-country`; unknown geo fails CLOSED (treated as required).
//   - attribution_first / attribution_last — UTM campaign snapshots
//     (first: write-if-absent; last: overwrite every landing).
//   - _fbc — derived from a Meta click id (?fbclid=) for CAPI matching
//     (write-if-absent, 90-day life). _fbp is set by the pixel JS, never here.
// Attribution + _fbc are written only when marketing consent is effective
// (an explicit accept OR the geo default).
type MarketingDecision = {
  autoGrant: boolean;
  marketingOk: boolean;
  incoming: ReturnType<typeof readAttributionFromSearchParams>;
  hasAttribution: boolean;
  fbclid: string | null;
  needFbc: boolean;
  // Serialized default-on consent record, present only when autoGrant.
  consentRecord: string | null;
};

// Evaluate what marketing state this request warrants — split out from the
// cookie writing so the normal pass-through path AND the /es rewrite path can
// share one decision (an es ad landing on /es/shows/* must capture UTM/_fbc
// and auto-grant consent exactly like a bare landing does).
function evaluateMarketing(req: NextRequest): MarketingDecision {
  const existing = parseConsent(req.cookies.get(CONSENT_COOKIE)?.value);
  const country = req.headers.get("x-vercel-ip-country");
  // No prior choice + consent not legally required here → default marketing ON.
  const autoGrant = !existing && !marketingConsentRequired(country);
  const marketingOk = existing?.marketing === true || autoGrant;
  const incoming = readAttributionFromSearchParams(req.nextUrl.searchParams);
  const hasAttribution = hasAnyField(incoming);
  const fbclid = req.nextUrl.searchParams.get("fbclid");
  const needFbc = !!fbclid && !req.cookies.get(FBC_COOKIE);
  const consentRecord = autoGrant
    ? serializeConsent({
        necessary: true,
        marketing: true,
        ts: Date.now(),
        v: CONSENT_VERSION,
      })
    : null;
  return {
    autoGrant,
    marketingOk,
    incoming,
    hasAttribution,
    fbclid,
    needFbc,
    consentRecord,
  };
}

// Build the base response (pass-through or rewrite). Injects REQUEST headers
// when the same render must see either the auto-granted consent cookie (banner
// hidden + pixel on the very first page) or the URL-derived locale.
function buildBaseResponse(
  req: NextRequest,
  d: MarketingDecision,
  opts: { rewriteTo?: URL; localeHeader?: string } = {},
): NextResponse {
  const needHeaders = d.autoGrant || !!opts.localeHeader;
  if (!needHeaders && !opts.rewriteTo) return NextResponse.next();
  const headers = new Headers(req.headers);
  if (opts.localeHeader) headers.set(URL_LOCALE_HEADER, opts.localeHeader);
  if (d.autoGrant && d.consentRecord) {
    const cookieHeader = headers.get("cookie");
    headers.set(
      "cookie",
      (cookieHeader ? `${cookieHeader}; ` : "") +
        `${CONSENT_COOKIE}=${encodeURIComponent(d.consentRecord)}`,
    );
  }
  return opts.rewriteTo
    ? NextResponse.rewrite(opts.rewriteTo, { request: { headers } })
    : NextResponse.next({ request: { headers } });
}

// Write the consent / attribution / _fbc cookies onto a response.
function writeMarketingCookies(
  res: NextResponse,
  req: NextRequest,
  d: MarketingDecision,
): void {
  const prod = process.env.NODE_ENV === "production";
  if (d.autoGrant && d.consentRecord) {
    res.cookies.set(CONSENT_COOKIE, d.consentRecord, {
      maxAge: CONSENT_MAX_AGE_SECONDS,
      sameSite: "lax",
      path: "/",
      secure: prod,
    });
  }
  if (d.marketingOk && d.hasAttribution) {
    const payload = serializeAttribution(d.incoming);
    if (!req.cookies.get(ATTRIBUTION_FIRST_COOKIE)) {
      res.cookies.set(ATTRIBUTION_FIRST_COOKIE, payload, {
        maxAge: ATTRIBUTION_FIRST_MAX_AGE,
        sameSite: "lax",
        // Not httpOnly: client-side analytics may read these; non-sensitive
        // UTM params the browser was already sending in the URL.
        path: "/",
        secure: prod,
      });
    }
    res.cookies.set(ATTRIBUTION_LAST_COOKIE, payload, {
      maxAge: ATTRIBUTION_LAST_MAX_AGE,
      sameSite: "lax",
      path: "/",
      secure: prod,
    });
  }
  if (d.marketingOk && d.needFbc && d.fbclid) {
    res.cookies.set(FBC_COOKIE, buildFbc(d.fbclid, Date.now()), {
      maxAge: ATTRIBUTION_FIRST_MAX_AGE,
      sameSite: "lax",
      // Not httpOnly: the Meta Pixel reads _fbc client-side to attach to
      // browser events, and CAPI reads it server-side via cookies().
      path: "/",
      secure: prod,
    });
  }
}

function applyMarketingCookies(req: NextRequest): NextResponse | null {
  const d = evaluateMarketing(req);
  // Nothing to persist: not auto-granting, and either no consent or no params.
  if (!d.autoGrant && (!d.marketingOk || (!d.hasAttribution && !d.needFbc))) {
    return null;
  }
  const res = buildBaseResponse(req, d);
  writeMarketingCookies(res, req, d);
  return res;
}

// Rewrite a Spanish subpath (/es/<base>) to its base route, stamping the locale
// on the request so the components render Spanish. Runs the SAME marketing +
// visitor cookie machinery as a bare landing, and sets the sticky locale cookie
// so the non-localized app surfaces (/watch, /subscribe) also render Spanish.
function applyLocalizedRewrite(req: NextRequest, basePath: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = basePath;
  const d = evaluateMarketing(req);
  const res = buildBaseResponse(req, d, { rewriteTo: url, localeHeader: "es" });
  writeMarketingCookies(res, req, d);
  res.cookies.set(LOCALE_COOKIE_NAME, "es", {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    path: "/",
    // httpOnly:false — mirrors the switcher cookie so client code reads it.
    secure: process.env.NODE_ENV === "production",
  });
  return applyVisitorCookie(req, res) ?? res;
}

// Mints the first-party audience-measurement cookie (matio_aid) when the
// visitor doesn't have one yet. Consent-exempt first-party analytics — the
// cookie itself is just a random UUID; all data lives server-side and is
// written ONLY by the /api/t beacon (JS-executing browsers), never here.
// Set once with a fixed 13-month life and deliberately never refreshed
// (CNIL exempt-measurement guidance). Skips bots (no point minting for
// crawlers), non-GET requests, and API/admin paths — page documents only.
function applyVisitorCookie(
  req: NextRequest,
  res: NextResponse | null,
): NextResponse | null {
  if (req.method !== "GET") return res;
  if (req.cookies.get(VISITOR_COOKIE)) return res;
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api") || path.startsWith("/admin")) return res;
  if (userAgent({ headers: req.headers }).isBot) return res;
  const out = res ?? NextResponse.next();
  out.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
    maxAge: VISITOR_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
  return out;
}

const handleRequest = clerkMiddleware(async (auth, req) => {
  // Consolidate the legacy production alias onto the apex so it isn't indexed
  // as a duplicate origin. Vercel does NOT auto-noindex production
  // *.vercel.app aliases (only preview deploys), and the alias currently
  // returns 200 — a permanent (308) redirect passes its signals to the apex.
  // Exact host match: never touches the apex, www (Vercel-redirected before
  // this runs), or per-deploy preview hostnames.
  if (req.headers.get("host") === LEGACY_ALIAS_HOST) {
    return NextResponse.redirect(
      new URL(req.nextUrl.pathname + req.nextUrl.search, SITE_URL),
      308,
    );
  }

  // Spanish subpath (/es/*): rewrite to the base route with the locale stamped
  // on the request. Only the indexable public set is localized — anything else
  // under /es (e.g. /es/admin) doesn't match isLocalizablePath, so it falls
  // through and 404s rather than bypassing the gates below.
  {
    const { locale, path } = stripLocalePrefix(req.nextUrl.pathname);
    if (locale === "es" && isLocalizablePath(path)) {
      return applyLocalizedRewrite(req, path);
    }
  }

  if (isAdminRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

    const role = await getUserRoleCached(userId);
    if (role !== "admin") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return;
  }

  if (isAuthRoute(req)) {
    // Payments off → /subscribe just redirects home at the page level, so
    // don't bounce anonymous visitors through Clerk sign-up first. Fall
    // through to the catch-all cookie capture instead of redirecting here:
    // middleware Set-Cookie survives the page's redirect('/'), so an ad
    // landing on /subscribe still gets its UTM/fbclid persisted.
    if (!paymentsEnabled()) {
      return applyVisitorCookie(req, applyMarketingCookies(req)) ?? undefined;
    }
    // Default the subscribe flow to sign-up rather than sign-in: most
    // visitors who reach /subscribe are first-timers about to create an
    // account, not returning users. Clerk's hosted sign-up page still
    // offers a "Already have an account? Sign in" affordance for the
    // minority case.
    const { userId, redirectToSignUp } = await auth();
    if (!userId) return redirectToSignUp({ returnBackUrl: req.url });
    // Attribution still captured for signed-in /subscribe visits — e.g.
    // a remarketing campaign that links a returning user straight here.
    return applyVisitorCookie(req, applyMarketingCookies(req)) ?? undefined;
  }

  // Spanish-preferring humans on a bare (English) localizable URL → 307 to the
  // /es twin so the URL matches the content and reinforces hreflang. Bots are
  // NOT redirected, so the English page stays the indexed default at the bare
  // path (Googlebot sends no Accept-Language → negotiateLocale → en anyway;
  // this is belt-and-braces for AI/es-header crawlers).
  if (
    req.method === "GET" &&
    isLocalizablePath(req.nextUrl.pathname) &&
    !userAgent({ headers: req.headers }).isBot
  ) {
    const cookieLocale = req.cookies.get(LOCALE_COOKIE_NAME)?.value;
    const wantsEs =
      cookieLocale === "es" ||
      (!cookieLocale &&
        negotiateLocale(req.headers.get("accept-language")) === "es");
    if (wantsEs) {
      const url = req.nextUrl.clone();
      url.pathname = localizedPath(req.nextUrl.pathname, "es");
      // 307 preserves method + query, so ?utm_*/?fbclid ride along to the /es
      // landing, where applyLocalizedRewrite captures them.
      return NextResponse.redirect(url, 307);
    }
  }

  // Catch-all: every other passthrough route captures attribution + _fbc. Ad
  // landings are nearly always /, /shows/*, or /watch/* — anything not
  // gated above.
  return applyVisitorCookie(req, applyMarketingCookies(req)) ?? undefined;
});

// STAGING LOCK — the outermost layer, ahead of everything above.
//
// Set `STAGING_LOCK_PASSWORD` (bench only, NEVER on production) and the whole
// origin asks for HTTP Basic Auth, plus every response is marked
// `noindex, nofollow`. It sits first on purpose: an anonymous hit must not
// reach the marketing machinery below, or a stray crawler would mint visitor
// and consent cookies — and attribution rows — on the bench.
//
// With the variable unset, the cost of all of this is a single environment
// read: no header parsing, no path matching, no extra allocation, on a file
// that runs for every request. Why the lock lives here at all rather than in
// Vercel's panel is explained in lib/staging-lock.ts.
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  const password = process.env.STAGING_LOCK_PASSWORD;
  if (!password) return handleRequest(req, event);
  return lockedRequest(req, event, password);
}

async function lockedRequest(
  req: NextRequest,
  event: NextFetchEvent,
  password: string,
) {
  const verdict = evaluateStagingLock(
    password,
    req.nextUrl.pathname,
    req.headers.get("authorization"),
  );
  if (verdict === "challenge") return stagingLockChallenge();
  // `?? NextResponse.next()` because a middleware handler may answer with
  // "carry on, nothing to add" — and even that response must carry the robots
  // header while the bench is locked.
  const res = (await handleRequest(req, event)) ?? NextResponse.next();
  res.headers.set(NOINDEX_HEADER, NOINDEX_VALUE);
  return res;
}

export const config = {
  matcher: [
    "/((?!_next|ingest|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
