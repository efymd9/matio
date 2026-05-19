import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { episodes, seasons, subscriptions, trialSessions } from "@/db/schema";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { TRIAL_COOKIE, TRIAL_DURATION_SECONDS } from "@/lib/trial";

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

  const [row] = await db
    .select({
      playbackId: episodes.muxPlaybackId,
      showId: seasons.showId,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(episodes.id, episodeId))
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

  // Trial path: unexpired trial_session cookie for this show. Note we
  // intentionally do NOT special-case trial.converted here — granting a
  // subscriber-length token to any cookie that once converted is a real
  // bypass for users who paid then canceled. They re-enter through the
  // signed-in active-subscription branch above; if that fails they have
  // no playback access. Converted is now an analytics-only marker.
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (sessionToken) {
    const [trial] = await db
      .select()
      .from(trialSessions)
      .where(
        and(
          eq(trialSessions.sessionToken, sessionToken),
          eq(trialSessions.showId, row.showId),
        ),
      )
      .limit(1);

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
    }
  }

  return NextResponse.json({ error: "Not authorized" }, { status: 403 });
}
