import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { episodes, seasons, shows } from "@/db/schema";
import type { CheckoutTargetInput } from "@/lib/checkout-session";

// Shared validation for the watch-flow params (show / ep / resume) that both
// checkout actions (signed-in createAuthCheckoutSession and guest
// createGuestCheckoutSession) thread through Stripe's return/cancel URLs. The
// params are attacker-controlled input (query string / form fields) that flows
// into the checkout page's links — a surface a user (or anti-phishing scanner)
// would inspect — so only a published show and a ready episode belonging to it
// pass; anything else is silently dropped and the URLs fall back to safe
// defaults.

export type CheckoutTarget = {
  showSlug: string | null;
  episodeId: string | null;
  resume: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveCheckoutTarget(
  input: CheckoutTargetInput,
): Promise<CheckoutTarget> {
  const showSlugRaw = input.show;
  const resumeRaw = input.resume;
  const epRaw = input.ep;

  let showSlug: string | null = null;
  if (typeof showSlugRaw === "string" && showSlugRaw) {
    const [match] = await db
      .select({ slug: shows.slug })
      .from(shows)
      .where(
        and(
          eq(shows.slug, showSlugRaw),
          eq(shows.status, "published"),
          isNull(shows.deletedAt),
        ),
      )
      .limit(1);
    if (match) showSlug = match.slug;
  }

  let episodeId: string | null = null;
  if (showSlug && typeof epRaw === "string" && UUID_RE.test(epRaw)) {
    const [epMatch] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(shows, eq(seasons.showId, shows.id))
      .where(
        and(
          eq(episodes.id, epRaw),
          eq(episodes.status, "ready"),
          eq(shows.slug, showSlug),
        ),
      )
      .limit(1);
    if (epMatch) episodeId = epMatch.id;
  }

  return {
    showSlug,
    episodeId,
    resume: typeof resumeRaw === "string" && resumeRaw ? resumeRaw : null,
  };
}

// "/watch/<slug>?ep=…&resume=…" for a validated target, or null when the
// checkout wasn't reached from a watch flow.
export function buildWatchPath(target: CheckoutTarget): string | null {
  if (!target.showSlug) return null;
  const params = new URLSearchParams();
  if (target.episodeId) params.set("ep", target.episodeId);
  if (target.resume) params.set("resume", target.resume);
  const qs = params.toString();
  return `/watch/${encodeURIComponent(target.showSlug)}${qs ? `?${qs}` : ""}`;
}
