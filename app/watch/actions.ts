"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import {
  episodes,
  seasons,
  showReminders,
  shows,
  trialSessions,
} from "@/db/schema";
import { stampVisitorWallSeen } from "@/lib/visitor";
import { paymentsEnabled, signupRequired } from "@/lib/free-mode";
import { getLocale } from "@/lib/i18n/server";
import {
  clampPositionSeconds,
  saveWatchProgressForUser,
} from "@/lib/watch-progress";
import { saveWatchSegmentsFor } from "@/lib/watch-segments-write";
import {
  getOrderedReadyEpisodeIds,
  showHasTierGating,
  resolveEffectiveTier,
} from "@/lib/episode-access";
import {
  TRIAL_COOKIE,
  TRIAL_DURATION_SECONDS,
  getClientIp,
  hashClientIp,
  stampSignupWall,
} from "@/lib/trial";

// Signed-in progress save. The write itself — position clamp, monotonic
// max_position_seconds, completed's flip-on-rewatch semantics, the
// watch_days ledger, the paid-mode ownership gate — lives in
// lib/watch-progress.ts and is shared with the app's POST /api/v1/progress.
// This action keeps its historical silent-return contract: the outcome is
// deliberately dropped.
export async function saveWatchProgress(
  episodeId: string,
  positionSeconds: number,
  completed: boolean,
) {
  const { userId } = await auth();
  if (!userId) return;

  await saveWatchProgressForUser(userId, episodeId, positionSeconds, completed);
}

// Audience-retention counter flush. The player marks each 10s bucket the
// playhead traverses (deduped for continuous playback, re-counted after a
// seek — that's what makes rewatch peaks visible) and flushes every ~20s.
// The write itself — timeline bound, dedupe, the per-(episode, day, bucket)
// increment, the session-row proof for anonymous callers, the signed-in
// watched-seconds credit — lives in lib/watch-segments-write.ts and is
// shared with the app's POST /api/v1/watch-segments. This action decides
// only WHO may flush from the web and keeps its historical silent-return
// contract: the outcome is deliberately dropped, invalid input never throws.
export async function saveWatchSegments(episodeId: string, buckets: number[]) {
  const { userId } = await auth();
  if (userId) {
    await saveWatchSegmentsFor({ kind: "user", userId }, episodeId, buckets);
    return;
  }
  // Anonymous flushes are only legitimate where anonymous playback exists:
  // open free mode, and — since #198 — a free-tier episode under the signup
  // gate. Paid-mode anonymous previews stay deliberately excluded (a
  // 60s-capped preview cohort would paint a fake everyone-leaves-at-60s
  // cliff onto the episode's retention curve). Neither free-mode shape has
  // a positional gate on the web, hence maxPosition: null.
  if (paymentsEnabled()) return;
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;
  await saveWatchSegmentsFor(
    {
      kind: "anonymous",
      sessionToken,
      maxPosition: null,
      // Under the gate only a free episode was anonymously playable; the
      // write refuses the rest on the row it already reads (#198).
      freeTierOnly: signupRequired(),
    },
    episodeId,
    buckets,
  );
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
  // Free pivot: with payments off every episode is anonymously playable as
  // the free tier, so every save takes the full-tracking branch (no 60s
  // cap, no member/tier-gating rejects) — mirrors the token route.
  // Signup gate: only a free episode is anonymously playable, so only it
  // may write; a save for anything above it is forged or stale and is
  // rejected — the same resolveEffectiveTier the token route mints from.
  const access = resolveEffectiveTier(row.access, {
    paymentsOn: paymentsEnabled(),
    signupGate: signupRequired(),
  });
  if (access === "free") {
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
          // Full-tracking writes belong to kind='episodes' rows ONLY. A
          // legacy kind='preview' row can hold this (cookie, show) slot —
          // free mode makes every show playable and a retiered show hits
          // this in paid mode too — and writing an uncapped position +
          // lastEpisodeId there breaks the preview invariants ("clamped at
          // the save source", no episode pointer) and misplaces the resume
          // offset if the row is ever read as a trial again.
          eq(trialSessions.kind, "episodes"),
        ),
      );
    return;
  }
  if (access === "member") return;
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
  | { ok: false; reason: "invalid_email" | "invalid_show" | "rate_limited" };

// New capture rows allowed per (hashed IP, rolling hour). Real viewers
// submit once per show; the cap exists so an anonymous attacker can't
// flood show_reminders with garbage addresses that the admin send would
// then blast through Resend (bounces poison sender reputation).
const REMINDER_RATELIMIT_PER_HOUR = 10;

// Records an email-reminder request for a show. Called from the
// SeriesEndOverlay when a viewer asks to be notified about the next
// episode. Idempotent on (show_id, email) via the unique constraint —
// the duplicate path returns ok=true so the UI shows the success state
// either way (no information leak about who already subscribed). A
// resubmit RE-ARMS the reminder (notified_at back to NULL): "notify me"
// after an already-dispatched episode means the NEXT one.
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

  // Rate limit NEW rows per (hashed IP, rolling hour) — count-then-insert
  // is soft (parallel requests can slightly overshoot) but this is an
  // anti-flood bound, not an exact quota. Same trusted-header + HMAC
  // hashing as the trial rate limit; no raw IPs stored.
  const ipHash = hashClientIp(getClientIp({ headers: await headers() }));
  const [recent] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(showReminders)
    .where(
      and(
        eq(showReminders.ipHash, ipHash),
        gt(showReminders.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    );
  if ((recent?.n ?? 0) >= REMINDER_RATELIMIT_PER_HOUR) {
    return { ok: false, reason: "rate_limited" };
  }

  // Best-effort link to the user when auth is available.
  const { userId } = await auth();

  // Snapshot the site locale so the reminder email renders in the
  // language the viewer was watching in.
  const locale = await getLocale();

  // Conflict path (same show + email) UPDATES instead of no-oping: it
  // re-arms notified_at (a post-send resubmit means "tell me about the
  // NEXT one" — DoNothing silently orphaned those viewers), refreshes
  // the locale to the most recent choice, and backfills user_id when a
  // previously-anonymous subscriber resubmits signed-in. created_at and
  // ip_hash keep their original values — the rate limit counts row
  // creation, not resubmits.
  await db
    .insert(showReminders)
    .values({ showId: show.id, email, userId: userId ?? null, locale, ipHash })
    .onConflictDoUpdate({
      target: [showReminders.showId, showReminders.email],
      set: {
        notifiedAt: null,
        locale,
        userId: sql`coalesce(${userId ?? null}, ${showReminders.userId})`,
      },
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
  // First-party visit ledger stamp is independent of the trial cookie —
  // a wall impression counts even for a browser that never minted a
  // trial session (signup-gate era: the wall renders with zero token
  // fetches). Reads its own aid cookie, never throws.
  await stampVisitorWallSeen();
  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;
  if (typeof showId !== "string" || showId.length === 0) return;
  try {
    await stampSignupWall(sessionToken, showId);
  } catch {
    // best-effort
  }
}
