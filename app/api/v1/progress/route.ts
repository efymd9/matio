import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import type { SaveProgressResponse } from "@/lib/api/types";
import { apiError, apiOk } from "@/lib/api/v1";
import { saveWatchProgressForUser } from "@/lib/watch-progress";

// POST /api/v1/progress — the app's watch-progress save.
//
// Native twin of the web's saveWatchProgress server action. The write itself
// is the SAME function (lib/watch-progress.ts:saveWatchProgressForUser), so
// the clamp, the monotonic max_position_seconds, completed's flip-on-rewatch
// semantics, the watch_days ledger and the paid-mode ownership gate cannot
// drift between the two surfaces. What this route adds is only the HTTP
// shape: Bearer auth (proxy.ts's matcher already covers /api, so auth()
// resolves @clerk/expo's session token), input validation with real status
// codes instead of the action's silent return, and no-store headers.
//
// Signed-in only. The web also tracks anonymous positions (trial_sessions,
// keyed on the cookie); the app does not yet — an anonymous call is 401 and
// writes nothing.
//
// Idempotent: the row is keyed on (user_id, episode_id) with ON CONFLICT DO
// UPDATE, so a double flush, a retried request or an app relaunch replaying
// the last save all land on the same row.

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  // Auth first: an anonymous caller learns nothing about the body's
  // validity and nothing is read or written on its behalf.
  const { userId } = await auth();
  if (!userId) {
    return apiError("unauthorized", "Sign in to save your progress.");
  }

  const body: unknown = await req.json().catch(() => null);
  const input =
    typeof body === "object" && body !== null
      ? (body as { episodeId?: unknown; positionSeconds?: unknown; completed?: unknown })
      : {};

  if (typeof input.episodeId !== "string" || !UUID_RE.test(input.episodeId)) {
    return apiError("bad_request", "A valid episodeId is required.");
  }
  if (typeof input.positionSeconds !== "number") {
    return apiError("bad_request", "positionSeconds must be a number.");
  }
  if (typeof input.completed !== "boolean") {
    return apiError("bad_request", "completed must be a boolean.");
  }

  const outcome = await saveWatchProgressForUser(
    userId,
    input.episodeId,
    input.positionSeconds,
    input.completed,
  );

  switch (outcome) {
    case "saved": {
      const payload: SaveProgressResponse = { ok: true };
      return apiOk(payload);
    }
    case "invalid_position":
      return apiError("bad_request", "positionSeconds is out of range.");
    case "not_found":
      return apiError("not_found", "Episode not found or not ready.");
    case "forbidden":
      // Paid mode only: a non-subscriber on a subscriber-tier episode. Same
      // machine-readable reason the token route uses for that wall.
      return apiError("forbidden", "Subscribe to watch.", {
        reason: "subscribe_required",
      });
  }
}
