"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import {
  getOrderedReadyEpisodeIds,
  showHasTierGating,
} from "@/lib/episode-access";
import {
  TRIAL_COOKIE,
  TRIAL_DURATION_SECONDS,
  stampSignupWall,
} from "@/lib/trial";

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

  const clamped = clampPositionSeconds(positionSeconds);
  if (clamped === null) return;

  // Verify the episode is actually playable: status='ready', on a
  // published, non-deleted show — and fetch the show's gating config in
  // the same query for the tier check below.
  const [ep] = await db
    .select({
      id: episodes.id,
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
  if (!ep) return;

  // Ownership gate: subscribers may write progress on anything; signed-in
  // non-subscribers only on episodes open to them (free or member tier).
  // All-subscriber (legacy 60s-trial) shows have no such episodes, so
  // non-subscribers are rejected there exactly as before. Mirrors the token
  // route's gate so progress rows can't be written for content the user
  // can't play.
  if (!(await hasActiveSubscription(userId))) {
    if (ep.access === "subscriber") return;
  }

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
    .select({
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
  if (!row) return;

  // Ownership scope: only the row matching (cookie, show) gets the
  // write. An attacker with any old/expired cookie can in principle
  // dirty their own trial position, but the clamp above bounds the
  // damage, and the row is rate-limit / ip-hash gated at creation.

  // Per-episode access decides the write shape:
  //  - free: full tracking (resume target + monotonic positional depth) —
  //    the only tier an anonymous viewer can legitimately play on a gated
  //    show; the position-0 guard keeps a vanished-episode race out.
  //  - member: never legitimately playable anonymously — a forged action
  //    call must not pollute the funnel row.
  //  - subscriber: on legacy 60s-preview shows (no tier-gated episode) keep
  //    the plain position write; on gated shows it's not anonymously
  //    playable, so no write.
  if (row.access === "free") {
    const orderedIds = await getOrderedReadyEpisodeIds(row.showId);
    const position = orderedIds.indexOf(episodeId) + 1;
    if (position === 0) return;
    await db
      .update(trialSessions)
      .set({
        lastPositionSeconds: clamped,
        lastEpisodeId: episodeId,
        furthestEpisodeNumber: sql`GREATEST(${trialSessions.furthestEpisodeNumber}, ${position})`,
      })
      .where(
        and(
          eq(trialSessions.sessionToken, sessionToken),
          eq(trialSessions.showId, row.showId),
        ),
      );
    return;
  }
  if (row.access === "member") return;
  if (await showHasTierGating(row.showId)) return;

  // Legacy 60s-preview row (kind='preview'). Cap the stored position at the
  // trial duration: buffered segments keep playing past token expiry and
  // seeks can land anywhere in the episode, so the raw playhead routinely
  // exceeds 60s — which inflated every depth metric on /admin/analytics.
  // A capped value reads as "watched the full preview".
  await db
    .update(trialSessions)
    .set({
      lastPositionSeconds: Math.min(clamped, TRIAL_DURATION_SECONDS),
    })
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

// Stamps signup_wall_at on the caller's session row for a show — fired by
// the SignupWall overlay on mount. This covers the end-of-free-tier path
// (episode 10 finishes → wall renders without any token request); the
// deep-link path is stamped server-side by the token route's 403. Write-
// once semantics live in stampSignupWall. Analytics-only: scoped to the
// caller's own cookie, no information returned.
export async function markSignupWallShown(showId: string) {
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;
  if (typeof showId !== "string" || showId.length === 0) return;
  try {
    await stampSignupWall(sessionToken, showId);
  } catch {
    // best-effort
  }
}
