import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import { readAttributionCookiesFromRequest } from "@/lib/attribution";
import { showHasTierGating } from "@/lib/episode-access";
import { signMuxPlaybackToken } from "@/lib/mux-token";
import { hasActiveSubscription } from "@/lib/subscription-access";
import {
  TRIAL_COOKIE,
  TRIAL_DURATION_SECONDS,
  TrialRateLimitError,
  findTrialSession,
  getClientIp,
  hashClientIp,
  mintTrialSession,
  stampSignupWall,
} from "@/lib/trial";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const runtime = "nodejs";

const SUBSCRIBER_TTL = 60 * 60; // 1h
// Cap trial JWT TTL at the trial duration so a token never outlives the row.
const TRIAL_TTL_CAP = TRIAL_DURATION_SECONDS;
const NO_CACHE = { "Cache-Control": "private, no-store" } as const;

// Structured, greppable log so token volume + outcome (esp. a trial 403/429
// spike that would flag a client refresh-loop regression) is queryable in
// Vercel runtime logs — the route was previously silent on success, which is
// why the original refresh-loop bug was invisible to monitoring.
function logToken(fields: {
  result: number;
  mode: "subscriber" | "trial" | "free" | "member" | "none";
  showId?: string;
  episodeId?: string | null;
}) {
  console.info(`[playback-token] ${JSON.stringify(fields)}`);
}

export async function GET(req: NextRequest) {
  const episodeId = req.nextUrl.searchParams.get("episode_id");
  if (!episodeId) {
    logToken({ result: 400, mode: "none" });
    return NextResponse.json(
      { error: "Missing episode_id" },
      { status: 400, headers: NO_CACHE },
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
      access: episodes.access,
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
    logToken({ result: 404, mode: "none", episodeId });
    return NextResponse.json(
      { error: "Episode not found or not ready" },
      { status: 404, headers: NO_CACHE },
    );
  }

  // Subscriber path. The access-granting set + current_period_end check
  // both live in hasActiveSubscription() — past_due users (whose latest
  // invoice failed and is being retried) keep playback, but a row whose
  // current_period_end already passed (e.g. a dropped
  // customer.subscription.deleted webhook left it as "active" forever)
  // is treated as unsubscribed.
  const { userId } = await auth();
  if (userId && (await hasActiveSubscription(userId))) {
    const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
    logToken({ result: 200, mode: "subscriber", showId: row.showId, episodeId });
    return NextResponse.json({
      token,
      expiresIn: SUBSCRIBER_TTL,
      mode: "subscriber",
    }, { headers: NO_CACHE });
  }

  // Per-episode access control: the episode's own `access` value decides
  // who may play it — free → anyone, member → any signed-in user,
  // subscriber → active subscription (subscribers already returned above).
  // A free or member episode implies a tier-gated show, so those paths need
  // no show-level lookup; only subscriber-tier episodes probe the show to
  // pick between the paywall (gated show) and the legacy 60s trial below.
  // Gated 403s carry a machine-readable `reason`; legacy 403s stay
  // reason-less.
  if (row.access === "free") {
    // Funnel tracking row (kind='episodes') — minted on the first free
    // play for this (cookie, show), carrying the attribution snapshot and
    // IP hash exactly like the legacy trial. STRICTLY best-effort: a rate
    // limit (or any DB hiccup) degrades tracking, never playback — free
    // content must not 429.
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
    const sessionToken = existingToken ?? crypto.randomUUID();
    let setCookie = false;
    try {
      const existing = existingToken
        ? await findTrialSession(existingToken, row.showId)
        : null;
      if (!existing) {
        await mintTrialSession({
          sessionToken,
          showId: row.showId,
          ipHash: hashClientIp(getClientIp(req)),
          attribution: readAttributionCookiesFromRequest(req),
          kind: "episodes",
        });
        setCookie = !existingToken;
      }
    } catch (err) {
      // TrialRateLimitError or transient DB failure — tracking skipped,
      // playback unaffected. Warn on the unexpected case so a systemic DB
      // failure can't silently zero the funnel (rate limits are normal
      // abuse-control noise, not failures).
      if (!(err instanceof TrialRateLimitError)) {
        console.warn(`[playback-token] free-tier tracking skipped: ${err}`);
      }
    }
    const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
    logToken({ result: 200, mode: "free", showId: row.showId, episodeId });
    const res = NextResponse.json(
      { token, expiresIn: SUBSCRIBER_TTL, mode: "free" },
      { headers: NO_CACHE },
    );
    if (setCookie) {
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

  if (row.access === "member") {
    if (userId) {
      const token = signMuxPlaybackToken(row.playbackId, SUBSCRIBER_TTL);
      logToken({
        result: 200,
        mode: "member",
        showId: row.showId,
        episodeId,
      });
      return NextResponse.json(
        { token, expiresIn: SUBSCRIBER_TTL, mode: "member" },
        { headers: NO_CACHE },
      );
    }
    // Anonymous request for a member episode → sign-up wall. Stamp the
    // funnel timestamp on the session's row when one exists (deep-link
    // path; the end-of-tier path stamps via markSignupWallShown).
    const cookieStore = await cookies();
    const existingToken = cookieStore.get(TRIAL_COOKIE)?.value;
    if (existingToken) {
      try {
        await stampSignupWall(existingToken, row.showId);
      } catch (err) {
        // analytics-only — never block the response
        console.warn(`[playback-token] signup-wall stamp skipped: ${err}`);
      }
    }
    logToken({ result: 403, mode: "free", showId: row.showId, episodeId });
    return NextResponse.json(
      { error: "Not authorized", reason: "signup_required" },
      { status: 403, headers: NO_CACHE },
    );
  }

  // access === "subscriber" and the requester isn't one (subscribers
  // returned earlier). On a tier-gated show this is the subscription
  // paywall; on an all-subscriber (legacy) show, fall through to the
  // 60-second trial path below.
  if (await showHasTierGating(row.showId)) {
    logToken({
      result: 403,
      mode: userId ? "member" : "free",
      showId: row.showId,
      episodeId,
    });
    return NextResponse.json(
      { error: "Not authorized", reason: "subscribe_required" },
      { status: 403, headers: NO_CACHE },
    );
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
      logToken({ result: 200, mode: "trial", showId: row.showId, episodeId });
      return NextResponse.json({
        token,
        expiresIn: ttl,
        mode: "trial",
      }, { headers: NO_CACHE });
    }
    // Expired row exists — don't issue a new trial for this show on the
    // same cookie. User must subscribe.
    logToken({ result: 403, mode: "trial", showId: row.showId, episodeId });
    return NextResponse.json({ error: "Not authorized" }, { status: 403, headers: NO_CACHE });
  }

  // No row yet for (cookie, show) — first preview for this show. Mint a
  // new row (with IP-bucket rate-limit) and set the cookie if missing.
  const sessionToken = existingToken ?? crypto.randomUUID();
  const ipHash = hashClientIp(getClientIp(req));
  // Snapshot the UTM cookies (set by proxy.ts on landing) at the moment
  // of first play. Stamping at trial-creation means every campaign's
  // trial-start count is queryable from the analytics dashboard without
  // requiring user signup.
  const attribution = readAttributionCookiesFromRequest(req);
  let mintedExpiresAt: Date;
  try {
    const fresh = await mintTrialSession({
      sessionToken,
      showId: row.showId,
      ipHash,
      attribution,
    });
    mintedExpiresAt = fresh.expiresAt;
  } catch (err) {
    if (err instanceof TrialRateLimitError) {
      // Generic body — don't confirm to an adversary that they hit a
      // per-network bucket (signal to rotate IPs / proxies); the client
      // identifies the case by status code, not text.
      logToken({ result: 429, mode: "trial", showId: row.showId, episodeId });
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { ...NO_CACHE, "Retry-After": String(60 * 60) },
        },
      );
    }
    throw err;
  }

  const remaining = Math.floor(
    (mintedExpiresAt.getTime() - Date.now()) / 1000,
  );
  const ttl = Math.min(Math.max(remaining, 0), TRIAL_TTL_CAP);
  const token = signMuxPlaybackToken(row.playbackId, ttl);
  logToken({ result: 200, mode: "trial", showId: row.showId, episodeId });
  const res = NextResponse.json({ token, expiresIn: ttl, mode: "trial" }, { headers: NO_CACHE });
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
