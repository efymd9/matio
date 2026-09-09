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

// The version of /terms whose §5-6 withdrawal waiver the buyer is accepting.
// Bumped by hand when that section changes, so a stored acceptance can be
// traced to the wording that was actually on screen. Date-stamped rather than
// numbered because /terms is dated, not versioned.
export const TOS_VERSION = "2026-08-16";

// Metadata keys carrying the acceptance. They ride the SAME channel as
// attribution and the CAPI identity — subscription_data.metadata — which is
// the only thing the cookie-less Stripe webhook can read. Deliberately NOT a
// new column: the acceptance is a fact about a person, and Stripe already
// holds the subscription it belongs to, so recording it there adds no new
// store of personal data (data minimisation, /gdpr).
//
// Unlike the capi_* keys these are NOT scrubbed after Purchase (#165): the
// waiver is the evidence that the buyer consented to immediate supply, so it
// has to outlive the event that created it. It contains no identifier beyond
// the subscription it is already attached to.
export const TOS_ACCEPTED_AT_KEY = "tos_accepted_at";
export const TOS_VERSION_KEY = "tos_version";

/**
 * The consent record written onto the subscription. `acceptedAt` is supplied by
 * the caller (never read from a clock in here) so the function stays pure and
 * testable.
 */
export function toWaiverMetadata(acceptedAt: Date): Record<string, string> {
  return {
    [TOS_ACCEPTED_AT_KEY]: acceptedAt.toISOString(),
    [TOS_VERSION_KEY]: TOS_VERSION,
  };
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
  | "waiver_not_accepted";

export function resolveWalletGate(input: {
  paymentsOn: boolean;
  flagOn: boolean;
  hasPublishableKey: boolean;
  inAppBrowser: boolean;
  signedIn: boolean;
  waiverAccepted: boolean;
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
  // Stripe cannot collect the EU/UK withdrawal waiver on this surface, so we
  // do; arriving here without it means the client was bypassed.
  if (!input.waiverAccepted) return "waiver_not_accepted";
  return "ok";
}
