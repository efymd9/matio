// The checkout → site return leg, shared by the signed-in checkout builder
// (app/subscribe/actions.ts) and the pages a buyer lands on. Universal and
// dependency-free so it is unit-testable without the Stripe/Clerk stack.

// Stripe substitutes this placeholder in return_url / success_url with the
// Checkout Session id (`cs_…`). The guest flow has always used it for
// /welcome; the signed-in flow appends it as `cs` so the landing page can fire
// the browser-side purchase beacon exactly once per purchase.
export const CHECKOUT_SESSION_PLACEHOLDER = "{CHECKOUT_SESSION_ID}";

export function buildCheckoutReturnUrl(
  origin: string,
  watchPath: string | null,
): string {
  if (watchPath) {
    const sep = watchPath.includes("?") ? "&" : "?";
    return `${origin}${watchPath}${sep}cs=${CHECKOUT_SESSION_PLACEHOLDER}`;
  }
  return `${origin}/?welcome=1&cs=${CHECKOUT_SESSION_PLACEHOLDER}`;
}

// A Checkout Session id as it arrives back in the URL: shape-validated, never
// trusted for anything but keying a beacon (it grants no data by itself).
export function parseCheckoutSessionParam(value: unknown): string | null {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]+$/.test(value)
    ? value
    : null;
}
