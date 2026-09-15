import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { guestCheckoutAttempts } from "@/db/schema";
import { describeError } from "@/lib/observability";

// Max guest (pay-first) checkout starts per IP per clock-hour. Generous — real
// households / mobile-carrier NAT pools behind one IP rarely start checkout
// this often, but it caps a cookieless script's blast radius on Stripe and the
// ad-conversion signal. Env-overridable so the threshold can be tuned without
// a redeploy of constants (raise it if a shared-NAT false positive appears).
export const GUEST_CHECKOUT_RATELIMIT_PER_HOUR = Number(
  process.env.GUEST_CHECKOUT_RATELIMIT_PER_HOUR ?? 30,
);

// Max signed-in checkout starts per ACCOUNT per clock-hour (#227). Since #217
// the auth builders create a session without an idempotency key (a replayed
// key handed out sessions the sweep had since expired), so every call to
// createAuthCheckoutSession / createAuthWalletCheckoutSession is a real
// `create` + `list` + N `expire` at Stripe and, with consent, a fresh
// InitiateCheckout / checkout_started pair. Ten an hour is far above what a
// buyer reloading /checkout or re-ticking the wallet box produces, and far
// below what a script needs to churn Stripe objects or inflate the funnel.
export const AUTH_CHECKOUT_RATELIMIT_PER_HOUR = Number(
  process.env.AUTH_CHECKOUT_RATELIMIT_PER_HOUR ?? 10,
);

const HOUR_MS = 60 * 60 * 1000;

// Atomic increment-and-read of the per-(bucketKey, hour) counter. Returns true
// when the caller is OVER `limit` (the action should block). The counter goes
// up on EVERY call, not only on successful creations — a flood of failing
// requests must be braked too. Fail-OPEN: any DB error returns false (allow) —
// an anti-abuse limiter must never block real revenue on an infra blip.
// Occasionally prunes windows older than 2h so the table self-cleans without
// a cron (checkout starts are low-frequency; the rare extra delete is
// negligible and awaited so it can't dangle in serverless).
//
// The key is whatever the caller hashes its identity into: the guest flow's
// HMAC of the client IP, the signed-in flow's `user:` + HMAC of the userId
// (#227). Only hashes reach the table — the column keeps its historical name
// `ip_hash` (renaming it is a migration, and nothing reads the name back).
export async function checkoutRateLimited(
  bucketKey: string,
  limit: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
  try {
    const [row] = await db
      .insert(guestCheckoutAttempts)
      .values({ ipHash: bucketKey, windowStart, count: 1 })
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

    return (row?.count ?? 1) > limit;
  } catch (err) {
    // Class and code only — a driver error quotes the statement it choked on,
    // and a connection failure can quote the connection string.
    console.warn("checkoutRateLimited: DB error — failing open", {
      error: describeError(err),
    });
    return false;
  }
}

// The guest (pay-first) flow's brake: per hashed client IP, 30/hour.
export async function guestCheckoutRateLimited(ipHash: string): Promise<boolean> {
  return checkoutRateLimited(ipHash, GUEST_CHECKOUT_RATELIMIT_PER_HOUR);
}
