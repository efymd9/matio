import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
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
import { LEGACY_ALIAS_HOST, SITE_URL } from "@/lib/seo";
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
function applyMarketingCookies(req: NextRequest): NextResponse | null {
  const existing = parseConsent(req.cookies.get(CONSENT_COOKIE)?.value);
  const country = req.headers.get("x-vercel-ip-country");
  // No prior choice + consent not legally required here → default marketing ON.
  const autoGrant = !existing && !marketingConsentRequired(country);
  const marketingOk = existing?.marketing === true || autoGrant;

  const incoming = readAttributionFromSearchParams(req.nextUrl.searchParams);
  const hasAttribution = hasAnyField(incoming);
  const fbclid = req.nextUrl.searchParams.get("fbclid");
  const needFbc = !!fbclid && !req.cookies.get(FBC_COOKIE);

  // Nothing to persist: not auto-granting, and either no consent or no params.
  if (!autoGrant && (!marketingOk || (!hasAttribution && !needFbc))) {
    return null;
  }

  const prod = process.env.NODE_ENV === "production";

  let res: NextResponse;
  if (autoGrant) {
    // Persist the default-on consent AND forward it on the request so the
    // layout's cookies() sees it on THIS request — banner hidden + pixel
    // rendered on the very first page, not the next one.
    const record = serializeConsent({
      necessary: true,
      marketing: true,
      ts: Date.now(),
      v: CONSENT_VERSION,
    });
    const headers = new Headers(req.headers);
    const cookieHeader = headers.get("cookie");
    headers.set(
      "cookie",
      (cookieHeader ? `${cookieHeader}; ` : "") +
        `${CONSENT_COOKIE}=${encodeURIComponent(record)}`,
    );
    res = NextResponse.next({ request: { headers } });
    res.cookies.set(CONSENT_COOKIE, record, {
      maxAge: CONSENT_MAX_AGE_SECONDS,
      sameSite: "lax",
      path: "/",
      secure: prod,
    });
  } else {
    res = NextResponse.next();
  }

  if (marketingOk && hasAttribution) {
    const payload = serializeAttribution(incoming);
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

  if (marketingOk && needFbc && fbclid) {
    res.cookies.set(FBC_COOKIE, buildFbc(fbclid, Date.now()), {
      maxAge: ATTRIBUTION_FIRST_MAX_AGE,
      sameSite: "lax",
      // Not httpOnly: the Meta Pixel reads _fbc client-side to attach to
      // browser events, and CAPI reads it server-side via cookies().
      path: "/",
      secure: prod,
    });
  }
  return res;
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

export default clerkMiddleware(async (auth, req) => {
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

  // Catch-all: every other passthrough route captures attribution + _fbc. Ad
  // landings are nearly always /, /shows/*, or /watch/* — anything not
  // gated above.
  return applyVisitorCookie(req, applyMarketingCookies(req)) ?? undefined;
});

export const config = {
  matcher: [
    "/((?!_next|ingest|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
