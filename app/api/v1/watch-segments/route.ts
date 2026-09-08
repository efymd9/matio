import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import type { SaveWatchSegmentsResponse } from "@/lib/api/types";
import { apiError, apiOk, readDeviceId, resolveSignupGate } from "@/lib/api/v1";
import { WATCH_SEGMENT_FLUSH_MAX_BUCKETS } from "@/lib/watch-segments";
import {
  saveWatchSegmentsFor,
  type SegmentsCaller,
} from "@/lib/watch-segments-write";

// POST /api/v1/watch-segments — the app's audience-retention flush.
//
// Native twin of the web's saveWatchSegments server action. The write is the
// SAME function (lib/watch-segments-write.ts:saveWatchSegmentsFor): the
// timeline bound, the dedupe, the (episode, day, bucket) increment, the
// session-row proof and the signed-in watched-seconds credit cannot drift
// between the two surfaces. What this route adds is the HTTP shape — Bearer
// auth OR the device-id header, strict input validation with real status
// codes instead of the action's silent return, and no-store headers — plus
// the ONE policy difference the app forces: anonymous flushes follow the
// app's POSITIONAL signup gate (resolveSignupGate), not the web's
// all-or-nothing rule, because under after_episodes: N an anonymous device
// legitimately watches the first N episodes of each show.
//
// Idempotent: the counter row is keyed on (episode_id, day, bucket) with
// ON CONFLICT DO UPDATE and the progress credit is UPDATE-only, so a retried
// request can never create a second row of either kind.

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const input =
    typeof body === "object" && body !== null
      ? (body as { episodeId?: unknown; buckets?: unknown })
      : {};

  if (typeof input.episodeId !== "string" || !UUID_RE.test(input.episodeId)) {
    return apiError("bad_request", "A valid episodeId is required.");
  }
  // Strict at the HTTP boundary, where a malformed entry is a client bug
  // worth surfacing; the shared write still bounds each bucket to the
  // episode's timeline underneath.
  const buckets = input.buckets;
  if (
    !Array.isArray(buckets) ||
    buckets.length === 0 ||
    buckets.length > WATCH_SEGMENT_FLUSH_MAX_BUCKETS ||
    !buckets.every((b) => Number.isInteger(b) && b >= 0)
  ) {
    return apiError(
      "bad_request",
      `buckets must hold 1..${WATCH_SEGMENT_FLUSH_MAX_BUCKETS} non-negative integers.`,
    );
  }

  // Identity: the Bearer session wins; otherwise the device id. proxy.ts's
  // matcher already covers /api, so auth() resolves @clerk/expo's token.
  const { userId } = await auth();
  let caller: SegmentsCaller;
  if (userId) {
    caller = { kind: "user", userId };
  } else {
    const deviceId = readDeviceId(req);
    if (!deviceId) {
      // Nothing to key a session row on — and nothing was read or written.
      return apiError("unauthorized", "Sign in or send a device id.");
    }
    const gate = resolveSignupGate();
    if (gate.mode === "tiers") {
      // Paid mode: anonymous playback is the 60s preview, which is
      // deliberately kept off the retention curve (see the web action).
      // No reason field: this refusal is analytics policy, not a wall — the
      // token route may well have answered 200 (trial) or subscribe_required
      // for the same episode, and the client routes walls off THAT answer,
      // never off a flush.
      return apiError("forbidden", "Anonymous playback is not counted.");
    }
    caller = {
      kind: "anonymous",
      // The app gates by POSITION, not by tier: its first episode plays
      // anonymously whatever the admin set (a login wall on first launch
      // is the likeliest App Store rejection). Deliberate divergence from
      // the web — see the mobile rule in CLAUDE.md.
      freeTierOnly: false,
      sessionToken: deviceId,
      maxPosition: gate.mode === "after_episodes" ? gate.episodes : null,
    };
  }

  const result = await saveWatchSegmentsFor(caller, input.episodeId, buckets);

  switch (result.outcome) {
    case "saved": {
      const payload: SaveWatchSegmentsResponse = { ok: true, accepted: result.accepted };
      return apiOk(payload);
    }
    case "invalid_input":
      return apiError("bad_request", "Malformed flush.");
    case "not_found":
      return apiError("not_found", "Episode not found or not ready.");
    case "forbidden":
      // Signed in: a non-subscriber on a subscriber-tier episode (paid mode).
      // Anonymous: past the positional gate. Same reasons the token route
      // answers for the same walls.
      return caller.kind === "user"
        ? apiError("forbidden", "Subscribe to watch.", { reason: "subscribe_required" })
        : apiError("forbidden", "Sign up to keep watching.", { reason: "signup_required" });
    case "no_session":
      // The device never started playback of this show through the token
      // route (or its best-effort tracking mint was rate-limited). No
      // reason field: this is not a wall the client can route to.
      return apiError("forbidden", "No playback session for this device on this show.");
  }
}
