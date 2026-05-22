import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";

// Single source of truth for which subscription statuses grant access.
// past_due is included so a user whose latest invoice failed isn't
// immediately locked out of the product they're paying for — Stripe
// retries the invoice over several days; during that window the user
// should still be able to watch and to update their card via the
// Customer Portal (which is where they'll go to fix the situation).
export const ACCESS_GRANTING_STATUSES = [
  "active",
  "trialing",
  "past_due",
] as const;

// Returns true if the user currently has an access-granting subscription
// whose current_period_end is still in the future. The period-end check
// is belt-and-braces: if customer.subscription.deleted gets dropped, the
// row stays at status='active' in our DB but the timestamp prevents free
// playback past the user's actual term.
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const [sub] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...ACCESS_GRANTING_STATUSES]),
        gt(subscriptions.currentPeriodEnd, new Date()),
      ),
    )
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);
  return !!sub;
}
