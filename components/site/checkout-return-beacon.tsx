import "server-only";

import { auth } from "@clerk/nextjs/server";
import { PurchasePixel } from "@/components/site/purchase-pixel";
import { parseCheckoutSessionParam } from "@/lib/checkout-return";
import { TRIAL_FEE_VALUE } from "@/lib/checkout-trial";
import { paymentsEnabled } from "@/lib/free-mode";
import { hasActiveSubscription } from "@/lib/subscription-access";

// Server half of the signed-in checkout return: a page that can carry
// `?cs=<Checkout Session>` (the watch page, the home fallback) renders this
// with the raw param, and it mounts the browser-side purchase beacon only when
// (a) payments are on, (b) the id is well-formed, and (c) the signed-in user
// really holds an access-granting subscription — i.e. the webhook has
// mirrored the purchase. Until then it renders nothing; the param survives a
// reload, so the beacon fires on the next visit once the mirror lands. The
// DB read happens only when the param is present — the hot path is untouched.
export async function CheckoutReturnBeacon({ cs }: { cs: unknown }) {
  if (!paymentsEnabled()) return null;
  const sessionId = parseCheckoutSessionParam(cs);
  if (!sessionId) return null;
  const { userId } = await auth();
  if (!userId || !(await hasActiveSubscription(userId))) return null;
  return (
    <PurchasePixel
      checkoutSessionId={sessionId}
      amountCents={TRIAL_FEE_VALUE * 100}
      currency="usd"
    />
  );
}
