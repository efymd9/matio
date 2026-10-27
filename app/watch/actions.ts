"use server";

import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { describeDbError, withRedactedFailure } from "@/lib/db-errors";
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
  resolveEffectiveTier,
} from "@/lib/episode-access";
import {
  TRIAL_COOKIE,
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

  // The SITE's view of payments — never the app's APP_FREE_WITH_ACCOUNT
  // lever (#476): the web stays paid whatever the app is told.
  await saveWatchProgressForUser(userId, episodeId, positionSeconds, completed, {
    paymentsOn: paymentsEnabled(),
  });
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
    // The site's view of payments, as for the progress save above (#476).
    await saveWatchSegmentsFor(
      { kind: "user", userId, paymentsOn: paymentsEnabled() },
      episodeId,
      buckets,
    );
    return;
  }
  // Anonymous flushes are only legitimate where anonymous playback exists:
  // open free mode, and — since #198 — a free-tier episode under the signup
  // gate. Paid mode keeps every anonymous flush out: it was there for the
  // 60s-capped preview cohort (a fake everyone-leaves-at-60s cliff on the
  // retention curve), which is gone since #462; counting anonymous free-tier
  // playback in paid mode is a separate decision (docs/registry.md). Neither
  // free-mode shape has a positional gate on the web, hence maxPosition: null.
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

// Anonymous position save (the player's mode="free"): keyed on
// (session_token, show_id), looked up via the episode's season → show
// relationship. Anonymous-only — signed-in viewers route to
// saveWatchProgress instead. The session row tracks no completion, so the
// caller's third arg is dropped. (The name is historical: the legacy 60s
// preview it was written for is gone since #462.)
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

  // The episode's effective tier for an anonymous viewer — the same
  // resolveEffectiveTier the watch page locks with and the token route mints
  // from — decides whether this save may write at all:
  //  - free: full tracking (resume target + monotonic positional depth) —
  //    the only tier an anonymous viewer can legitimately play; the
  //    position-0 guard keeps a vanished-episode race out.
  //  - anything above it (member, and subscriber, which an anonymous viewer
  //    meets as the sign-up wall in paid mode since #462): never playable
  //    anonymously — a forged or stale call must not pollute the funnel row.
  // Free pivot: with payments off every episode is anonymously playable as
  // the free tier, so every save takes the full-tracking branch — mirrors
  // the token route. Signup gate: only a free episode is.
  const access = resolveEffectiveTier(row.access, {
    paymentsOn: paymentsEnabled(),
    signupGate: signupRequired(),
    // Anonymous by contract: the trial cookie is the only identity here.
    signedIn: false,
  });
  if (access !== "free") return;
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
        // legacy kind='preview' row (minted before #462 removed the
        // preview) can hold this (cookie, show) slot, and writing an
        // uncapped position + lastEpisodeId there breaks the preview
        // invariants ("clamped at the save source", no episode pointer)
        // the legacy dashboard still reads.
        eq(trialSessions.kind, "episodes"),
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
  | {
      ok: false;
      // server_error: the database refused the upsert (#425).
      reason: "invalid_email" | "invalid_show" | "rate_limited" | "server_error";
    };

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

  // Snapshot of the site locale — "en" since #445 (the site is English-only).
  // The column stays as data; the reminder email no longer reads it (every
  // row, an older `es` one included, gets the English email).
  const locale = await getLocale();

  // Conflict path (same show + email) UPDATES instead of no-oping: it
  // re-arms notified_at (a post-send resubmit means "tell me about the
  // NEXT one" — DoNothing silently orphaned those viewers), refreshes
  // the locale to the most recent choice, and backfills user_id when a
  // previously-anonymous subscriber resubmits signed-in. created_at and
  // ip_hash keep their original values — the rate limit counts row
  // creation, not resubmits.
  //
  // The upsert binds the address, so its failure comes out of
  // withRedactedFailure without the driver's text (#425) and is answered
  // here: the runtime log gets the show id, class and SQLSTATE; Sentry the
  // redacted error, for its stack. A typed answer, not a throw — the overlay
  // shows its generic error for it, the copy a thrown action got before.
  try {
    await withRedactedFailure("reminder capture: upsert show_reminders by address", () =>
      db
        .insert(showReminders)
        .values({ showId: show.id, email, userId: userId ?? null, locale, ipHash })
        .onConflictDoUpdate({
          target: [showReminders.showId, showReminders.email],
          set: {
            notifiedAt: null,
            locale,
            userId: sql`coalesce(${userId ?? null}, ${showReminders.userId})`,
          },
        }),
    );
  } catch (err) {
    const { name, code } = describeDbError(err);
    console.error("subscribeToShowReminder: failed", { showId: show.id, name, code });
    Sentry.captureException(err, {
      level: "error",
      tags: { showId: show.id, code: code ?? "none", name },
    });
    return { ok: false, reason: "server_error" };
  }

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
