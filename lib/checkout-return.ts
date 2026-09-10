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

// Substitutes the placeholder ourselves, for the one surface where Stripe
// cannot: the paywall's wallet button confirms in the browser with
// `redirect: 'if_required'`, so on an inline success there is no Stripe
// redirect to do the substitution. The server knows the real session id the
// moment it creates the session, so it bakes it in and hands the finished URL
// to the client (issue #210).
//
// This is not a weaker handle than Stripe's own substitution: whoever supplies
// the id, lib/checkout-return-verify.ts re-reads the session AT STRIPE and
// requires it to be complete, paid, and owned by this user's customer. A
// forged or foreign id yields nothing.
export function withCheckoutSessionId(url: string, sessionId: string): string {
  return url.split(CHECKOUT_SESSION_PLACEHOLDER).join(sessionId);
}

// A Checkout Session id as it arrives back in the URL: shape-validated, never
// trusted for anything but keying a beacon (it grants no data by itself).
export function parseCheckoutSessionParam(value: unknown): string | null {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]+$/.test(value)
    ? value
    : null;
}
