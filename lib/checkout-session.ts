import "server-only";

// Shared contract between the checkout server actions (app/subscribe/actions.ts
// signed-in, app/subscribe/guest-actions.ts guest) and the in-site /checkout
// page that drives them. Lives in its own non-"use server" module because a
// "use server" file may only export async functions — the type + the env probe
// below can't live alongside the actions.

// The watch-flow params threaded through checkout (validated against the DB by
// resolveCheckoutTarget). Plain object, not FormData — the /checkout client
// calls the action programmatically rather than via a <form action>.
export type CheckoutTargetInput = {
  show?: string | null;
  ep?: string | null;
  resume?: string | null;
};

// What a checkout action returns to the client. `embedded` carries the Stripe
// Checkout Session client secret to mount the in-page iframe; `hosted` is the
// graceful fallback (no publishable key configured) that full-navigates to the
// Stripe-hosted page exactly as before; `redirect` is a guard bounce (already
// subscribed, rate-limited, flag off) the client performs with router.replace.
export type CheckoutSessionResult =
  | { kind: "embedded"; clientSecret: string }
  | { kind: "hosted"; url: string }
  | { kind: "redirect"; to: string };

// Embedded Checkout needs a publishable key on the client (loadStripe). When
// it's unset we create a HOSTED session and redirect — identical to the
// pre-embedded behavior — so a deploy that hasn't received the key yet keeps
// working instead of rendering a dead iframe. NEXT_PUBLIC_* is inlined at build
// and is also a real server-side env var, so this read is valid in the action.
export function embeddedCheckoutEnabled(): boolean {
  return !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
}
