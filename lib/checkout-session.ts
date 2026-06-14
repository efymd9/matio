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
// working instead of rendering a dead iframe.
//
// IMPORTANT: read at REQUEST time, dynamically, NOT via `process.env.NEXT_PUBLIC_…`
// (which Next inlines at build time). The publishable key was added to the env
// AFTER an existing build, and Vercel's build cache reuses Next's inlined client
// chunks across an env-only change — so a build-time read can be stale (server
// says embedded while the client never got the key → dead iframe; or vice
// versa). NEXT_PUBLIC_* vars are present in the server runtime env on Vercel, so
// a dynamic `process.env[name]` lookup returns the deployment's CURRENT value.
// The client can't read env at runtime, so the /checkout page reads this server
// side and passes the key down as a prop (see app/checkout/page.tsx).
const PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY";

// `name` is a parameter, so the bundler can't constant-fold this into a
// build-time inline — it stays a runtime lookup.
function readRuntimeEnv(name: string): string | undefined {
  return process.env[name];
}

export function getPublishableKey(): string | null {
  const key = readRuntimeEnv(PUBLISHABLE_KEY_ENV);
  return key && key.length > 0 ? key : null;
}

export function embeddedCheckoutEnabled(): boolean {
  return getPublishableKey() !== null;
}
