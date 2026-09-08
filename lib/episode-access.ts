import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";

// Per-episode access control. An episode's tier IS its `access` column
// (free | member | subscriber — admin-set, default subscriber). A show is
// tier-gated iff any ready episode sits below the subscriber tier
// (showHasTierGating); all-subscriber shows keep the legacy 60-second
// preview. Positions in the ready ordering (getOrderedReadyEpisodeIds)
// remain the funnel's depth metric.

export type EpisodeTier = "free" | "member" | "subscriber";

// The ONE rule for "what tier does this episode behave as, right now" —
// called by the watch page (what the player locks client-side), the token
// route (what it mints or 403s) and the watch actions (what an anonymous
// save may write). Three seams that must never drift: the free pivot cost
// us exactly that lesson when only the token route was neutralised.
//
// - Paid mode: the admin's tier, verbatim. free plays for anyone, member
//   asks for an account, subscriber asks for money.
// - Free mode WITH the signup gate (REQUIRE_SIGNUP=1): the admin's tier
//   decides again, with one substitution — `subscriber` behaves as
//   `member`, because with payments off the paywall's CTA leads to
//   /subscribe, which redirects home. A wall that sells nothing is worse
//   than a wall that asks for the account we can actually create. Flip
//   PAYMENTS_ENABLED=1 and the paid branch above turns it into a real
//   paywall with no code change.
// - Free mode without the gate: everything is free, as the pivot intends.
//
// Signed-in viewers under the gate render in mode="member", where the
// member tier is unlocked — so they keep playing everything for free.
export function resolveEffectiveTier(
  access: EpisodeTier,
  { paymentsOn, signupGate }: { paymentsOn: boolean; signupGate: boolean },
): EpisodeTier {
  if (paymentsOn) return access;
  if (!signupGate) return "free";
  return access === "free" ? "free" : "member";
}

// Ordered ready-episode ids for a show; position = array index + 1. The
// caller is responsible for show-level checks (published, not deleted) —
// every current caller has already verified them.
//
// Branches (branch_of_episode_id NOT NULL, #143) are excluded: they are
// reachable only through a fork choice, never by position, so counting them
// would shift every funnel depth and signup-gate position after a fork.
// A branch id therefore resolves to position 0 here — callers already treat
// that as "not in the linear run".
export async function getOrderedReadyEpisodeIds(
  showId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.showId, showId),
        eq(episodes.status, "ready"),
        isNull(episodes.branchOfEpisodeId),
      ),
    )
    .orderBy(asc(seasons.number), asc(episodes.number));
  return rows.map((r) => r.id);
}

// A show is tier-gated iff at least one READY episode is open below the
// subscriber tier. Gated shows use per-episode walls; shows where every
// ready episode is subscriber-only keep the legacy 60-second preview.
// One indexed probe — limit 1, not a count. Branches are excluded for the
// same reason as above: a listed all-subscriber show must not flip to the
// per-episode walls because a hidden branch happens to carry a lower tier.
export async function showHasTierGating(showId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(seasons.showId, showId),
        eq(episodes.status, "ready"),
        ne(episodes.access, "subscriber"),
        isNull(episodes.branchOfEpisodeId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
