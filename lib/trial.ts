import "server-only";
import crypto from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { trialSessions, type TrialSession } from "@/db/schema";

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
// show) unique constraint makes this idempotent under multi-tab races. If
// ipHash is provided, enforces TRIAL_RATELIMIT_PER_HOUR / (ip, show) /
// hour and throws TrialRateLimitError when exceeded.
export async function mintTrialSession({
  sessionToken,
  showId,
  ipHash,
}: {
  sessionToken: string;
  showId: string;
  ipHash: string | null;
}): Promise<TrialSession> {
  if (ipHash) {
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
// shipped to the client, and rotates with the signing key. Returns null if
// the salt is missing or the IP is empty (rate-limit then skipped, which
// fail-opens — preferable to locking out legitimate users behind a quirky
// proxy chain).
export function hashClientIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.MUX_SIGNING_KEY_PRIVATE_KEY;
  if (!salt) return null;
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

// Pulls the client IP from a NextRequest. Vercel sets `x-forwarded-for` to
// `client, proxy1, proxy2` — the leftmost entry is what we want.
export function getClientIp(req: { headers: Headers }): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  return real?.trim() || null;
}

// Called from pages that the user lands on after Clerk sign-up. Attaches any
// unlinked trial_sessions rows that share the user's cookie to their user id.
export async function linkTrialSessionsToCurrentUser(): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  const sessionToken = (await cookies()).get(TRIAL_COOKIE)?.value;
  if (!sessionToken) return;

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

