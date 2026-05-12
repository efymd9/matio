import "server-only";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { trialSessions, type TrialSession } from "@/db/schema";

export const TRIAL_DURATION_SECONDS = 60;
export const TRIAL_COOKIE = "trial_session";

// Creates a trial_sessions row for (sessionToken, showId) if one doesn't
// already exist, then returns the row. Idempotent — concurrent visits to the
// same show with the same cookie won't duplicate.
export async function getOrCreateTrialSession(
  sessionToken: string,
  showId: string,
): Promise<TrialSession> {
  const expiresAt = new Date(Date.now() + TRIAL_DURATION_SECONDS * 1000);

  const inserted = await db
    .insert(trialSessions)
    .values({ sessionToken, showId, expiresAt })
    .onConflictDoNothing({
      target: [trialSessions.sessionToken, trialSessions.showId],
    })
    .returning();

  if (inserted.length > 0) return inserted[0];

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

  if (!existing) {
    // Should be unreachable: insert was a no-op so a row must exist.
    throw new Error("trial_sessions row vanished between upsert and select");
  }
  return existing;
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
// Flips converted = true on every trial_sessions row this user owns so we
// stop trying to gate them.
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

export function isTrialActive(trial: TrialSession): boolean {
  if (trial.converted) return true;
  return trial.expiresAt.getTime() > Date.now();
}

// Remaining seconds clamped to [0, TRIAL_DURATION_SECONDS]
export function trialRemainingSeconds(trial: TrialSession): number {
  if (trial.converted) return TRIAL_DURATION_SECONDS;
  const remaining = Math.floor((trial.expiresAt.getTime() - Date.now()) / 1000);
  return Math.max(0, remaining);
}

