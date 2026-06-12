import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { guestCheckoutAttempts } from "@/db/schema";

// Max guest (pay-first) checkout starts per IP per clock-hour. Generous — real
// households / mobile-carrier NAT pools behind one IP rarely start checkout
// this often, but it caps a cookieless script's blast radius on Stripe and the
// ad-conversion signal. Env-overridable so the threshold can be tuned without
// a redeploy of constants (raise it if a shared-NAT false positive appears).
export const GUEST_CHECKOUT_RATELIMIT_PER_HOUR = Number(
  process.env.GUEST_CHECKOUT_RATELIMIT_PER_HOUR ?? 30,
);

const HOUR_MS = 60 * 60 * 1000;

// Atomic increment-and-read of the per-(ipHash, hour) counter. Returns true
// when the caller is OVER the limit (the action should block). Fail-OPEN: any
// DB error returns false (allow) — an anti-abuse limiter must never block real
// revenue on an infra blip. Occasionally prunes windows older than 2h so the
// table self-cleans without a cron (guest checkout is low-frequency; the rare
// extra delete is negligible and awaited so it can't dangle in serverless).
export async function guestCheckoutRateLimited(ipHash: string): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
  try {
    const [row] = await db
      .insert(guestCheckoutAttempts)
      .values({ ipHash, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [guestCheckoutAttempts.ipHash, guestCheckoutAttempts.windowStart],
        set: { count: sql`${guestCheckoutAttempts.count} + 1` },
      })
      .returning({ count: guestCheckoutAttempts.count });

    if (Math.random() < 0.05) {
      await db
        .delete(guestCheckoutAttempts)
        .where(lt(guestCheckoutAttempts.windowStart, new Date(now - 2 * HOUR_MS)));
    }

    return (row?.count ?? 1) > GUEST_CHECKOUT_RATELIMIT_PER_HOUR;
  } catch (err) {
    console.warn("guestCheckoutRateLimited: DB error — failing open", { err });
    return false;
  }
}
