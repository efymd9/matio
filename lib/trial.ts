import "server-only";
import crypto from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { trialSessions, users, type TrialSession } from "@/db/schema";

export const TRIAL_DURATION_SECONDS = 60;
export const TRIAL_COOKIE = "trial_session";

// Cap on trial-row creations per (client-IP, show) per hour. Stops the
// "clear cookies → fresh 60s" loop without disrupting households on a
// shared IP watching different shows.
export const TRIAL_RATELIMIT_PER_HOUR = 3;
const RATELIMIT_WINDOW_MS = 60 * 60 * 1000;

// Lightweight error so the route handler can map to a 429 cleanly.
export class TrialRateLimitError extends Error {
  constructor() {
    super("Trial rate limit exceeded");
    this.name = "TrialRateLimitError";
  }
}

// Read-only lookup. Returns null if the (cookie, show) pair has no row yet —
// which is the steady-state for a first-time visitor or for a returning
// user visiting a new show on the same cookie.
export async function findTrialSession(
  sessionToken: string,
  showId: string,
): Promise<TrialSession | null> {
  const [existing] = await db
    .select()
    .from(trialSessions)
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        eq(trialSessions.showId, showId),
      ),
    )
    .limit(1);
  return existing ?? null;
}

// Mint a fresh trial_sessions row for (sessionToken, showId). The (token,
// show) unique constraint makes this idempotent under multi-tab races.
// Always enforces TRIAL_RATELIMIT_PER_HOUR / (ip, show) / hour and throws
// TrialRateLimitError when exceeded — there is no skip-on-missing-IP
// branch, because that path was a bypass: clients that scrubbed the
// upstream proxy header would get unlimited trial mints.
export async function mintTrialSession({
  sessionToken,
  showId,
  ipHash,
}: {
  sessionToken: string;
  showId: string;
  ipHash: string;
}): Promise<TrialSession> {
  const since = new Date(Date.now() - RATELIMIT_WINDOW_MS);
  const [{ value }] = await db
    .select({ value: count() })
    .from(trialSessions)
    .where(
      and(
        eq(trialSessions.ipHash, ipHash),
        eq(trialSessions.showId, showId),
        gt(trialSessions.startedAt, since),
      ),
    );
  if (value >= TRIAL_RATELIMIT_PER_HOUR) {
    throw new TrialRateLimitError();
  }

  const expiresAt = new Date(Date.now() + TRIAL_DURATION_SECONDS * 1000);
  const inserted = await db
    .insert(trialSessions)
    .values({ sessionToken, showId, expiresAt, ipHash })
    .onConflictDoNothing({
      target: [trialSessions.sessionToken, trialSessions.showId],
    })
    .returning();
  if (inserted.length > 0) return inserted[0];

  // Conflict path: another concurrent request already created the row for
  // this (sessionToken, showId). Read it back.
  const existing = await findTrialSession(sessionToken, showId);
  if (!existing) {
    throw new Error("trial_sessions row vanished between upsert and select");
  }
  return existing;
}

// Derives the stable hash bucket for rate-limiting. Uses the Mux signing
// private key as the HMAC salt — it's already required server-side, never
// shipped to the client, and rotates with the signing key. Always returns
// a string: a missing salt is a server-config error that would already
// have broken JWT signing upstream, so we fall back to a constant only
// to keep the type non-nullable; in any healthy deployment the env var
// is present.
const TRIAL_HASH_FALLBACK_SALT = "matio-trial-fallback-salt";

export function hashClientIp(ip: string): string {
  const salt = process.env.MUX_SIGNING_KEY_PRIVATE_KEY ?? TRIAL_HASH_FALLBACK_SALT;
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

// Resolve the client IP for rate-limit bucketing. We deliberately only
// trust `x-vercel-forwarded-for`: Vercel sets this header itself to a
// single, untainted client IP. The standard `x-forwarded-for` is
// appended-to (not overridden) at the edge, so its leftmost entry is
// whatever the client sent — using it as the bucket key let an attacker
// rotate IPs by simply varying the header on each request.
//
// In local dev there is no Vercel edge, so the header is absent and we
// fall back to a constant. That puts all un-identifiable requests into
// a single shared bucket — fail-closed under abuse (3 trials per show
// total for the whole anonymous pool), painless for local development.
export function getClientIp(req: { headers: Headers }): string {
  const vercelIp = req.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelIp) return vercelIp;
  return "unknown";
}

// Called from pages that the user lands on after Clerk sign-up. Attaches any
// unlinked trial_sessions rows that share the user's cookie to their user id.
//
// Race guard: trial_sessions.user_id has an FK to users.id. If this runs
// before the Clerk user.created webhook has mirrored the user into our
// table (common on fast signups), the UPDATE would throw an FK violation
// and crash the page. Confirm the users row exists first; if it doesn't
// yet, skip — the Stripe webhook's markUserTrialsConverted is keyed on
// userId too, so callers that need the link should call
// getOrSyncCurrentUser() before this helper to guarantee the mirror.
export async function linkTrialSessionsToCurrentUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;

  const [mirror] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!mirror) return;

  await db
    .update(trialSessions)
    .set({ userId })
    .where(
      and(
        eq(trialSessions.sessionToken, sessionToken),
        isNull(trialSessions.userId),
      ),
    );
}

// Called from the Stripe webhook when a user's subscription becomes active.
// Flips converted = true on every trial_sessions row this user owns. This is
// an analytics-only marker now (it powers the trial-to-paid metric on the
// admin analytics dashboard). Playback gating no longer reads converted —
// see app/api/playback-token/route.ts for the rationale.
export async function markUserTrialsConverted(userId: string): Promise<void> {
  await db
    .update(trialSessions)
    .set({ converted: true })
    .where(
      and(
        eq(trialSessions.userId, userId),
        eq(trialSessions.converted, false),
      ),
    );
}

// Whether the trial window is still open. We deliberately don't special-case
// trial.converted — granting playback to any cookie that once converted is a
// bypass for users who paid then canceled. Conversion is enforced via active
// subscription lookups, not via this flag.
export function isTrialActive(trial: TrialSession): boolean {
  return trial.expiresAt.getTime() > Date.now();
}

// Remaining seconds clamped to [0, TRIAL_DURATION_SECONDS]
export function trialRemainingSeconds(trial: TrialSession): number {
  const remaining = Math.floor((trial.expiresAt.getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

