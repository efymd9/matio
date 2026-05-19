import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { episodes, seasons, shows, subscriptions } from "@/db/schema";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import {
  TRIAL_COOKIE,
  TRIAL_DURATION_SECONDS,
  TrialRateLimitError,
  findTrialSession,
  getClientIp,
  hashClientIp,
  mintTrialSession,
} from "@/lib/trial";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const runtime = "nodejs";

const SUBSCRIBER_TTL = 60 * 60; // 1h
// Cap trial JWT TTL at the trial duration so a token never outlives the row.
const TRIAL_TTL_CAP = TRIAL_DURATION_SECONDS;

export async function GET(req: NextRequest) {
  const episodeId = req.nextUrl.searchParams.get("episode_id");
  if (!episodeId) {
    return NextResponse.json(
      { error: "Missing episode_id" },
      { status: 400 },
    );
  }

  // Belt-and-braces gate: episode must be ready, show must be published and
  // not soft-deleted. Without this, anyone with a leaked draft episode id +
  // an auto-issued trial cookie could mint a 60s preview for unreleased
  // content. The watch page applies the same filters at render time, but
  // this endpoint is the actual token-issuance gate.
  const [row] = await db
    .select({
      playbackId: episodes.muxPlaybackId,
      showId: seasons.showId,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.status, "ready"),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);

  if (!row || !row.playbackId) {
    return NextResponse.json(
      { error: "Episode not found or not ready" },
      { status: 404 },
    );
  }

  // Subscriber path: any active subscription → 1h token.
  const { userId } = await auth();
  if (userId) {
    const [sub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active"),
        ),
      )
      .limit(1);
    if (sub) {
      const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
      return NextResponse.json({
        token,
        expiresIn: SUBSCRIBER_TTL,
        mode: "subscriber",
      });
    }
  }

  // Trial path. Note we intentionally do NOT special-case trial.converted —
  // granting a subscriber-length token to any cookie that once converted is
  // a real bypass for users who paid then canceled. They re-enter through
  // the signed-in active-subscription branch above; if that fails they have
  // no playback access. Converted is now an analytics-only marker.
  //
  // Cookie minting and row creation both happen here (not in proxy.ts) so
  // (a) the 60s clock starts when the user actually plays, not on page
  // load, and (b) we never issue a cookie or row for a non-existent /
  // unpublished / not-ready show — the gate above already rejected those.
  const cookieStore = await cookies();
  const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
  const trial = existingToken
    ? await findTrialSession(existingToken, row.showId)
    : null;

  // Active row → mint trial token with TTL capped at the row's remaining.
  if (trial) {
    const remaining = Math.floor(
      (trial.expiresAt.getTime() - Date.now()) / 1000,
    );
    if (remaining > 0) {
      const ttl = Math.min(remaining, TRIAL_TTL_CAP);
      const token = signMuxPlaybackToken(row.playbackId, ttl);
      return NextResponse.json({
        token,
        expiresIn: ttl,
        mode: "trial",
      });
    }
    // Expired row exists — don't issue a new trial for this show on the
    // same cookie. User must subscribe.
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // No row yet for (cookie, show) — first preview for this show. Mint a
  // new row (with IP-bucket rate-limit) and set the cookie if missing.
  const sessionToken = existingToken ?? crypto.randomUUID();
  const ipHash = hashClientIp(getClientIp(req));
  let mintedExpiresAt: Date;
  try {
    const fresh = await mintTrialSession({
      sessionToken,
      showId: row.showId,
      ipHash,
    });
    mintedExpiresAt = fresh.expiresAt;
  } catch (err) {
    if (err instanceof TrialRateLimitError) {
      return NextResponse.json(
        { error: "Too many trial starts from this network" },
        { status: 429 },
      );
    }
    throw err;
  }

  const remaining = Math.floor(
    (mintedExpiresAt.getTime() - Date.now()) / 1000,
  );
  const ttl = Math.min(Math.max(remaining, 0), TRIAL_TTL_CAP);
  const token = signMuxPlaybackToken(row.playbackId, ttl);
  const res = NextResponse.json({ token, expiresIn: ttl, mode: "trial" });
  if (!existingToken) {
    res.cookies.set(TRIAL_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  }
  return res;
}
