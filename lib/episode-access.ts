import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons } from "@/db/schema";

// Per-episode access control. An episode's tier IS its `access` column
// (free | member | subscriber — admin-set, default subscriber), and every
// show is walled per episode. The legacy 60-second preview for shows whose
// ready episodes are all subscriber-only is gone (#462): an anonymous viewer
// on a subscriber episode is asked for an account first, the paywall comes
// after. Positions in the ready ordering (getOrderedReadyEpisodeIds) remain
// the funnel's depth metric.

export type EpisodeTier = "free" | "member" | "subscriber";

// The ONE rule for "what tier does this episode behave as, for this viewer,
// right now" — called by the watch page (what the player locks client-side),
// the token route (what it mints or 403s, through resolveRequestTier) and the
// watch actions (what an anonymous save may write). Three seams that must
// never drift: the free pivot cost us exactly that lesson when only the
// token route was neutralised.
//
// - Paid mode: the admin's tier, with one substitution for an ANONYMOUS
//   viewer — `subscriber` behaves as `member` (#462). Registration first,
//   then the paywall: a viewer without an account gets the sign-up wall
//   (prop-driven, no token fetch); once signed in, the same episode reads as
//   `subscriber` again and the paywall sells it. free plays for anyone,
//   member asks for an account.
// - Free mode WITH the signup gate (REQUIRE_SIGNUP=1): the admin's tier
//   decides again, with the same substitution for everyone — `subscriber`
//   behaves as `member`, because with payments off the paywall's CTA leads
//   to /subscribe, which redirects home. A wall that sells nothing is worse
//   than a wall that asks for the account we can actually create. Flip
//   PAYMENTS_ENABLED=1 and the paid branch above turns it into a real
//   paywall with no code change.
// - Free mode without the gate: everything is free, as the pivot intends.
//
// `signedIn` is required so every caller states whose view it computes. Free
// mode ignores it here: signed-in viewers under the gate render in
// mode="member", where the member tier is unlocked, so they keep playing
// everything for free (the token route coerces them in resolveRequestTier).
export function resolveEffectiveTier(
  access: EpisodeTier,
  {
    paymentsOn,
    signupGate,
    signedIn,
  }: { paymentsOn: boolean; signupGate: boolean; signedIn: boolean },
): EpisodeTier {
  if (paymentsOn) {
    return access === "subscriber" && !signedIn ? "member" : access;
  }
  if (!signupGate) return "free";
  return access === "free" ? "free" : "member";
}

// The same rule from the token route's point of view. With payments off a
// signed-in viewer plays everything (the "free with an account" pivot), so
// the request mints on the member path regardless of the episode's tier.
// Everything else is the episode rule above: an anonymous request for a free
// episode mints, anything above it 403s `signup_required` (in paid mode too,
// #462); a signed-in non-subscriber on a subscriber episode in paid mode
// 403s `subscribe_required`.
export function resolveRequestTier(
  access: EpisodeTier,
  opts: { paymentsOn: boolean; signupGate: boolean; signedIn: boolean },
): EpisodeTier {
  if (!opts.paymentsOn && opts.signedIn) return "member";
  return resolveEffectiveTier(access, opts);
}

// Does an episode of this tier play with no account at all? The honest
// answer for schema.org `isAccessibleForFree` — Google reads a registration
// wall as a paywall, so this may only be true when nothing is asked of the
// viewer. Always the anonymous view: that is who the claim is about.
export function isFreeToWatch(
  access: EpisodeTier,
  opts: { paymentsOn: boolean; signupGate: boolean },
): boolean {
  return resolveEffectiveTier(access, { ...opts, signedIn: false }) === "free";
}

// The series-level claim: schema.org's TVSeries.isAccessibleForFree is about
// the whole thing, so it may only be true when EVERY ready episode plays
// with no account. A series with a free first episode and a walled tail is
// not "free" — its episodes carry their own flags for that.
export function seriesIsFreeToWatch(
  readyAccess: EpisodeTier[],
  opts: { paymentsOn: boolean; signupGate: boolean },
): boolean {
  if (readyAccess.length === 0) return false;
  return readyAccess.every((access) => isFreeToWatch(access, opts));
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
