// The paywall's in-place wallet button (Apple Pay / Google Pay), issue #210.
//
// Universal and PURE except for the one env read below, so the client half
// (components/watch/wallet-express-checkout.tsx) and the server actions can
// share the consent-record shape without a second definition of it.

// Kill-switch. Runtime read, bind-at-deploy: unset = the wallet slot never
// renders and no `ui_mode: 'elements'` session is ever created, so the whole
// vertical ships dark and rolls back without a code change. Read through a
// parameterised lookup for the same reason lib/checkout-session.ts does — a
// bare `process.env.X` is constant-folded at build time, and this flag has to
// be flippable on an already-built deployment.
function readRuntimeEnv(name: string): string | undefined {
  return process.env[name];
}

export function walletCheckoutEnabled(): boolean {
  return readRuntimeEnv("WALLET_EXPRESS_CHECKOUT") === "1";
}

// The /terms edition the buyer accepts by ticking the wallet checkbox (Terms of
// Service + the §5-6 withdrawal waiver in one box, #214). Bumped by hand when
// /terms or the checkbox wording changes, so a stored acceptance can be traced
// to what was on screen. Date-stamped because /terms is dated, not numbered:
// 2026-08-16 is its last CONTENT change (the entity update noted in the page's
// header). NB the page's visible "Last updated" still reads May 27, 2026 — a
// stale date on the page itself, raised with the owner, not a reason to
// misstate the edition here.
export const TOS_VERSION = "2026-08-16";

// Metadata key carrying the acceptance. It rides the SAME channel as
// attribution and the CAPI identity — subscription_data.metadata — which is the
// only thing the cookie-less Stripe webhook can read. Deliberately NOT a new
// column: Stripe already holds the subscription it belongs to, so recording it
// there adds no new store of personal data (data minimisation, /gdpr).
//
// Unlike the capi_* keys it is NOT scrubbed after Purchase (#165): it is part of
// the contract record and has to outlive the event that created it.
export const TOS_VERSION_KEY = "tos_version";

/**
 * The consent record written onto the subscription: WHICH terms were accepted,
 * and deliberately no time. A clock read here would ride the create params into
 * the idempotency digest — a key unique per call, which is the parallel-tab
 * double charge — and rounding it to keep the key stable back-dates the
 * acceptance (#214). The exact moment is the Checkout Session's own `created`,
 * which cannot precede the tick that caused it.
 */
export function toConsentMetadata(): Record<string, string> {
  return { [TOS_VERSION_KEY]: TOS_VERSION };
}

// Why a wallet session may or may not be created. Pure and exhaustive so the
// answer is one table instead of a ladder of `if`s spread across a server
// action — the free-pivot lesson is that a gate implemented at two seams
// eventually disagrees with itself.
//
// Only `payments_off` is a redirect; every other refusal is "no wallet here,
// keep the card CTA", which is a normal state, not an error.
export type WalletGateVerdict =
  | "ok"
  | "payments_off"
  | "flag_off"
  | "no_publishable_key"
  | "in_app_browser"
  | "anonymous"
  | "consent_not_accepted";

export function resolveWalletGate(input: {
  paymentsOn: boolean;
  flagOn: boolean;
  hasPublishableKey: boolean;
  inAppBrowser: boolean;
  signedIn: boolean;
  consentAccepted: boolean;
}): WalletGateVerdict {
  // Order matters: payments first (it is the only one that redirects), then
  // the cheap local checks, and only then anything about this buyer.
  if (!input.paymentsOn) return "payments_off";
  if (!input.flagOn) return "flag_off";
  if (!input.hasPublishableKey) return "no_publishable_key";
  // Apple Pay is unreliable and Google Pay is impossible in the Meta webviews
  // where most ad traffic lands, so those keep the hosted path (lib/in-app-browser.ts).
  if (input.inAppBrowser) return "in_app_browser";
  // v1 is signed-in only — a guest wallet purchase also mints a Clerk account
  // and a sign-in ticket from the wallet's email, and earns its own PR.
  if (!input.signedIn) return "anonymous";
  // Stripe cannot collect the Terms acceptance or the EU/UK withdrawal waiver
  // on this surface, so our checkbox does. This refuses a client that SAYS the
  // box is unticked; it cannot prove a human ticked it — no checkbox can.
  if (!input.consentAccepted) return "consent_not_accepted";
  return "ok";
}
