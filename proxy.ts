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

export default clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

    const [row] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row || row.role !== "admin") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return;
  }

  if (isAuthRoute(req)) {
    const { userId, redirectToSignIn } = await auth();
    if (!userId) return redirectToSignIn({ returnBackUrl: req.url });
    return;
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
