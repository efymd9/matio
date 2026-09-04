import { PurchasePixel } from "@/components/site/purchase-pixel";
import type { VerifiedCheckoutReturn } from "@/lib/checkout-return-verify";

// The one-liner pages drop into their JSX after `verifyCheckoutReturn()`:
// nothing for a null result, the browser purchase beacon for a verified one.
// Keyed by the Stripe subscription id, amount/currency = what was charged.
export function PurchaseBeacon({
  result,
}: {
  result: VerifiedCheckoutReturn | null;
}) {
  if (!result) return null;
  return (
    <PurchasePixel
      purchaseKey={result.subscriptionId}
      amountCents={result.amountCents}
      currency={result.currency}
    />
  );
}
