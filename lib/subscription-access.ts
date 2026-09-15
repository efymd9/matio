import "server-only";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-status";

// The status list itself lives in the universal lib/subscription-status.ts
// (the erasure core needs it under tsx); this module stays the app's import
// site for it.
export { ACCESS_GRANTING_STATUSES } from "@/lib/subscription-status";

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
