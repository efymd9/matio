import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { watchProgress, type User } from "@/db/schema";
import { getOrSyncCurrentUser } from "@/lib/admin";
import type { EpisodeProgressResponse, SaveProgressResponse } from "@/lib/api/types";
import { apiError, apiOk } from "@/lib/api/v1";
import { isForeignKeyViolation } from "@/lib/db-errors";
import { describeError } from "@/lib/observability";
import {
  saveWatchProgressForUser,
  type SaveWatchProgressOutcome,
} from "@/lib/watch-progress";

// POST /api/v1/progress — the app's watch-progress save.
// GET  /api/v1/progress?episodeId=<uuid> — the viewer's resume point for it.
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

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("unauthorized", "Sign in to resume where you left off.");
  }

  const episodeId = req.nextUrl.searchParams.get("episodeId");
  if (!episodeId || !UUID_RE.test(episodeId)) {
    return apiError("bad_request", "A valid episodeId is required.");
  }

  // The caller's own row only — the key is the session's user, never a
  // parameter. No episode/show check: a position is the viewer's own data,
  // and whether the episode still plays is the token route's answer.
  const [row] = await db
    .select({ positionSeconds: watchProgress.positionSeconds })
    .from(watchProgress)
    .where(and(eq(watchProgress.userId, userId), eq(watchProgress.episodeId, episodeId)))
    .limit(1);

  // Returned as stored, `completed` or not — the web's resume rule
  // (app/watch/[showSlug]/page.tsx). A finished episode's row holds its end,
  // and the app's RESUME_TAIL_SECONDS turns that into a start from 0:00.
  const payload: EpisodeProgressResponse = { positionSeconds: row?.positionSeconds ?? 0 };
  return apiOk(payload);
}

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

  const episodeId = input.episodeId;
  const positionSeconds = input.positionSeconds;
  const completed = input.completed;
  const save = () =>
    saveWatchProgressForUser(userId, episodeId, positionSeconds, completed);

  let outcome: SaveWatchProgressOutcome;
  try {
    outcome = await save();
  } catch (err) {
    // Only the missing `users` mirror row is ours to heal (#303); anything
    // else stays the framework's to report, exactly as before.
    if (!isForeignKeyViolation(err)) throw err;
    const healed = await healAndRetry(userId, save);
    if (healed === null) {
      return apiError("unavailable", "Your account is still being set up. Try again shortly.");
    }
    outcome = healed;
  }

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

// A foreign-key violation on a signed-in save means the `users` mirror row is
// missing: a fresh in-app sign-up whose Clerk user.created webhook has not
// landed yet (retry backoff, an outage). The web heals the same gap on the
// watch page's render; the app never renders a server page, so the save does
// it — once, then retries once. Null = not healed: the caller answers 503 and
// the app's saver simply tries again on its next tick.
//
// Never a resurrection: getOrSyncCurrentUser reads the user from CLERK before
// it writes anything, and Clerk deletes the account before it sends the
// user.deleted that erases the row — for an erased account that read throws
// (Clerk answers 404), which lands here as `sync_failed` with nothing
// written. The write it does make is ON CONFLICT DO NOTHING, so a webhook
// landing at the same moment wins without an error. The app's «Delete
// account» (#309) runs the other way round — our erasure first, Clerk after
// — so a heal inside that gap CAN write; that route looks at `users` once
// more after Clerk's delete and erases what it finds (its step 3).
async function healAndRetry(
  userId: string,
  save: () => Promise<SaveWatchProgressOutcome>,
): Promise<SaveWatchProgressOutcome | null> {
  let user: User | null;
  try {
    user = await getOrSyncCurrentUser();
  } catch (err) {
    return notHealed(userId, "sync_failed", err);
  }
  if (!user) return notHealed(userId, "no_user");
  try {
    return await save();
  } catch (err) {
    return notHealed(userId, "retry_failed", err);
  }
}

// Ids, a step code and the error's class only — a driver error quotes the
// row it choked on, and the synced user carries an address (log audit).
function notHealed(
  userId: string,
  step: "sync_failed" | "no_user" | "retry_failed",
  err?: unknown,
): null {
  console.warn("v1/progress: users mirror not healed", {
    userId,
    step,
    ...(err === undefined ? {} : { error: describeError(err) }),
  });
  return null;
}
