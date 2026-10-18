import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import type { PlaybackMode, PlaybackTokenResponse } from "@/lib/api/types";
import { apiError, apiOk, readDeviceId, resolveSignupGate } from "@/lib/api/v1";
import { getOrderedReadyEpisodeIds } from "@/lib/episode-access";
import { paymentsEnabled } from "@/lib/free-mode";
import { signMuxPlaybackToken, signMuxStoryboardToken } from "@/lib/mux-token";
import { hasActiveSubscription } from "@/lib/subscription-access";
import { EMPTY_ATTRIBUTION } from "@/lib/attribution";
import {
  TrialRateLimitError,
  findTrialSession,
  getClientIp,
  hashClientIp,
  mintTrialSession,
  stampSignupWall,
} from "@/lib/trial";

// POST /api/v1/playback-token — the app's playback gate and the ONLY place a
// Mux JWT is minted for it.
//
// Native twin of app/api/playback-token/route.ts. Three deliberate differences,
// all forced by there being no browser:
//
//  1. POST, not GET. It has side effects (trial-row minting, wall stamping) and
//     must never be cached by an intermediary.
//  2. The anonymous identity is the DEVICE ID header, not the trial_session
//     cookie — proxy.ts skips /api for cookie minting, and a native client has
//     no cookie jar. The device UUID takes the session-token slot in
//     trial_sessions, giving the app the same per-(identity, show) rows.
//  3. The signup gate is POSITIONAL and softer than the web's hard
//     REQUIRE_SIGNUP wall — see lib/api/v1.ts:resolveSignupGate.
//
// Auth: proxy.ts's matcher already covers /(api|trpc)(.*), so clerkMiddleware
// runs here and auth() resolves an `Authorization: Bearer <session token>`
// from @clerk/expo with no extra wiring.

export const runtime = "nodejs";

const SUBSCRIBER_TTL = 60 * 60; // 1h, matching the web

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Same structured, greppable shape as the web route so both surfaces are
// queryable together in Vercel runtime logs.
function logToken(fields: {
  result: number;
  mode: PlaybackMode | "none";
  showId?: string;
  episodeId?: string | null;
}) {
  console.info(`[v1/playback-token] ${JSON.stringify(fields)}`);
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const episodeId =
    typeof body === "object" && body !== null && "episodeId" in body
      ? (body as { episodeId?: unknown }).episodeId
      : undefined;

  if (typeof episodeId !== "string" || !UUID_RE.test(episodeId)) {
    logToken({ result: 400, mode: "none" });
    return apiError("bad_request", "A valid episodeId is required.");
  }

  const deviceId = readDeviceId(req);

  // Same belt-and-braces gate as the web route: the episode must be ready and
  // its show published and not soft-deleted. Without this, a leaked draft
  // episode id would mint a playable token for unreleased content.
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
    return apiError("not_found", "Episode not found or not ready.");
  }

  const playbackId = row.playbackId;
  const ok = (mode: PlaybackMode, ttl: number) => {
    logToken({ result: 200, mode, showId: row.showId, episodeId });
    const payload: PlaybackTokenResponse = {
      playbackId,
      token: signMuxPlaybackToken(playbackId, ttl),
      // The app's scrub-preview frames (#375): audience `s`, the same ttl.
      storyboardToken: signMuxStoryboardToken(playbackId, ttl),
      expiresIn: ttl,
      mode,
    };
    return apiOk(payload);
  };

  // --- subscriber -------------------------------------------------------
  // hasActiveSubscription() carries both the access-granting status set and
  // the current_period_end check; never re-derive either here.
  const { userId } = await auth();
  if (userId && (await hasActiveSubscription(userId))) {
    return ok("subscriber", SUBSCRIBER_TTL);
  }

  // --- effective tier ---------------------------------------------------
  // Paid mode: the episode's own tier decides. Free mode: signed-in viewers
  // take the member path; anonymous viewers are free UNLESS the positional
  // signup gate puts this episode out of reach.
  const gate = resolveSignupGate();
  let access = row.access;

  if (!paymentsEnabled()) {
    if (userId) {
      access = "member";
    } else if (gate.mode === "after_episodes") {
      // One extra query, only on the anonymous gated path. Position is the
      // index in the show's ready ordering — the same ordering the web funnel
      // counts depth by, so "episode 2" means the same thing on both.
      const ordered = await getOrderedReadyEpisodeIds(row.showId);
      const position = ordered.indexOf(episodeId) + 1;
      access = position > 0 && position <= gate.episodes ? "free" : "member";
    } else {
      access = "free";
    }
  }

  // --- free -------------------------------------------------------------
  if (access === "free") {
    // Funnel tracking, STRICTLY best-effort: a rate limit or DB hiccup
    // degrades measurement, never playback — free content must not 429.
    // Without a device id there is simply nothing to key a row on.
    if (deviceId) {
      try {
        const existing = await findTrialSession(deviceId, row.showId);
        if (!existing) {
          await mintTrialSession({
            sessionToken: deviceId,
            showId: row.showId,
            ipHash: hashClientIp(getClientIp(req)),
            // A device row — never linked to an account by the web's IP
            // fallback (#349).
            client: "app",
            // No UTM cookies exist for a native client; install attribution is
            // a separate, coarser system (see docs/mobile-app-plan.md §10).
            attribution: { first: EMPTY_ATTRIBUTION, last: EMPTY_ATTRIBUTION },
            kind: "episodes",
          });
        }
      } catch (err) {
        // Ids only: the driver's message quotes the failed statement WITH
        // its params — this device's id and the IP hash (#305).
        if (!(err instanceof TrialRateLimitError)) {
          console.warn(
            `[v1/playback-token] free tracking skipped ${JSON.stringify({
              showId: row.showId,
              episodeId,
            })}`,
          );
        }
      }
    }
    return ok("free", SUBSCRIBER_TTL);
  }

  // --- member -----------------------------------------------------------
  if (access === "member") {
    if (userId) return ok("member", SUBSCRIBER_TTL);

    // Anonymous at the wall. Stamp the funnel timestamp on this device's row
    // when one exists; analytics-only, never blocks the response.
    if (deviceId) {
      try {
        await stampSignupWall(deviceId, row.showId);
      } catch {
        // Ids only, same reason as the free-tracking catch above.
        console.warn(
          `[v1/playback-token] signup-wall stamp skipped ${JSON.stringify({
            showId: row.showId,
            episodeId,
          })}`,
        );
      }
    }
    logToken({ result: 403, mode: "free", showId: row.showId, episodeId });
    return apiError("forbidden", "Sign up to keep watching.", {
      reason: "signup_required",
    });
  }

  // --- subscriber-tier episode, requester isn't one ----------------------
  // Paid mode only (free mode never leaves `access` at "subscriber"). Every
  // show answers the same, all-subscriber ones included: the legacy 60-second
  // preview that used to follow here is gone (#462), so no request through
  // here mints a kind='preview' row. A signed-in non-subscriber gets the
  // «Subscribers only» page from this 403 (#316). An anonymous device gets the
  // same answer — unlike the web, which asks it for an account first: the app
  // locks a subscriber episode up front for a signed-out viewer with
  // `subscribe_required` (lib/api/types.ts:isEpisodeLockedForApp), because it
  // sells nothing (App Store 3.1.1), so this only answers a direct call.
  logToken({ result: 403, mode: userId ? "member" : "free", showId: row.showId, episodeId });
  return apiError("forbidden", "Subscribe to watch.", {
    reason: "subscribe_required",
  });
}
