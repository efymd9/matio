import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";

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

export default clerkMiddleware(async (auth, req) => {
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
    // Default the subscribe flow to sign-up rather than sign-in: most
    // visitors who reach /subscribe are first-timers about to create an
    // account, not returning users. Clerk's hosted sign-up page still
    // offers a "Already have an account? Sign in" affordance for the
    // minority case.
    const { userId, redirectToSignUp } = await auth();
    if (!userId) return redirectToSignUp({ returnBackUrl: req.url });
    return;
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
