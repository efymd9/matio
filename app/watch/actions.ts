"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import {
  episodes,
  seasons,
  showReminders,
  shows,
  trialSessions,
  watchProgress,
} from "@/db/schema";
import { hasActiveSubscription } from "@/lib/subscription-access";
import { TRIAL_COOKIE } from "@/lib/trial";

// Hard ceiling on position values that can be written. The longest
// imaginable single episode is ~3-4h; 24h is a generous bound that
// rejects pathological values (negative, NaN, 10^9, …) without
// constraining real playback. Returns null when the value is anything
// other than a finite non-negative number within range.
const POSITION_SECONDS_MAX = 24 * 60 * 60;
function clampPositionSeconds(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < 0 || n > POSITION_SECONDS_MAX) return null;
  return Math.floor(n);
}

export async function saveWatchProgress(
  episodeId: string,
  positionSeconds: number,
  completed: boolean,
) {
  const { userId } = await auth();
  if (!userId) return;

  // Ownership gate: only access-granting subscribers may write
  // watch_progress. Without this, any signed-in user could call the
  // action with any episode UUID and poison their own row — or use
  // error/no-error differentiation to enumerate episode UUIDs (since
  // watchProgress has an FK to episodes.id). Mirrors the watch page
  // and playback-token route gates.
  if (!(await hasActiveSubscription(userId))) return;

  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return;

  // Verify the episode is actually playable: status='ready', on a
  // published, non-deleted show. The FK alone (episodeId → episodes.id)
  // would allow drafts and soft-deleted catalog entries to leak into
  // the resume queue.
  const [ep] = await db
    .select({ id: episodes.id })
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
  if (!ep) return;

  await db
    .insert(watchProgress)
    .values({
      userId,
      episodeId,
      positionSeconds: clamped,
      completed,
    })
    .onConflictDoUpdate({
      target: [watchProgress.userId, watchProgress.episodeId],
      set: {
        positionSeconds: clamped,
        completed,
        updatedAt: new Date(),
      },
    });
}

// Trial-mode position save: keyed on (session_token, show_id), looked up via
// the episode's season → show relationship. Anonymous-only — subscribers
// route to saveWatchProgress instead. Trial sessions don't track completion
// (single-show trial; no Up Next), so the caller's third arg is dropped.
export async function saveTrialPosition(
  episodeId: string,
  positionSeconds: number,
) {
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;

  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return;

  // Same episode-validity gate as the subscriber path: only ready
  // episodes on published, non-deleted shows. Stops a stray client
  // (or a forged form post on the cookie) from writing positions
  // against drafts or unpublished assets.
  const [row] = await db
    .select({ showId: seasons.showId })
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
  if (!row) return;

  // Ownership scope: only the row matching (cookie, show) gets the
  // write. An attacker with any old/expired cookie can in principle
  // dirty their own trial position, but the clamp above bounds the
  // damage, and the row is rate-limit / ip-hash gated at creation.
  await db
    .update(trialSessions)
    .set({ lastPositionSeconds: clamped })
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        eq(trialSessions.showId, row.showId),
      ),
    );
}

// RFC 5322 email regex would be 100+ chars and still wouldn't fully
// validate. We just need to reject obvious garbage before the DB
// constraint catches duplicates — keep this lax and let Resend do the
// real deliverability check at send time.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LEN = 254; // RFC 3696 — full address upper bound

export type ShowReminderResult =
  | { ok: true }
  | { ok: false; reason: "invalid_email" | "invalid_show" };

// Records an email-reminder request for a show. Called from the
// SeriesEndOverlay when a viewer asks to be notified about the next
// episode. Idempotent on (show_id, email) via the unique constraint —
// the duplicate path returns ok=true so the UI shows the success state
// either way (no information leak about who already subscribed).
//
// Anonymous and trial users can submit; the user_id column is filled in
// when an auth context is available, NULL otherwise. We don't gate on
// subscription status — a churned subscriber asking for episode pings
// is exactly the audience to re-engage.
export async function subscribeToShowReminder(input: {
  showId: string;
  email: string;
}): Promise<ShowReminderResult> {
  const rawEmail = typeof input.email === "string" ? input.email.trim() : "";
  // Lowercase before hitting the unique constraint — otherwise
  // "Alice@Example.com" and "alice@example.com" map to two rows.
  const email = rawEmail.toLowerCase();
  if (
    !email ||
    email.length > EMAIL_MAX_LEN ||
    !EMAIL_RE.test(email)
  ) {
    return { ok: false, reason: "invalid_email" };
  }

  const showId =
    typeof input.showId === "string" && input.showId ? input.showId : null;
  if (!showId) return { ok: false, reason: "invalid_show" };

  // Verify the show exists, is published, and not soft-deleted. Without
  // this, any UUID would create a row tying the email to a phantom
  // show — would clog the future dispatcher and lets an attacker probe
  // for show id existence by error/no-error differentiation.
  const [show] = await db
    .select({ id: shows.id })
    .from(shows)
    .where(
      and(
        eq(shows.id, showId),
        eq(shows.status, "published"),
        isNull(shows.deletedAt),
      ),
    )
    .limit(1);
  if (!show) return { ok: false, reason: "invalid_show" };

  // Best-effort link to the user when auth is available. The column is
  // nullable and the row is identified by (show_id, email), so a later
  // signed-in resubmission with the same email will hit the unique
  // constraint and be deduped without us needing to backfill user_id.
  const { userId } = await auth();

  await db
    .insert(showReminders)
    .values({ showId: show.id, email, userId: userId ?? null })
    .onConflictDoNothing({
      target: [showReminders.showId, showReminders.email],
    });

  return { ok: true };
}
