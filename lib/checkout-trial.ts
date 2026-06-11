import "server-only";

// $1 intro trial (2026-06-11). Every new checkout charges a one-time $1
// today, runs a 3-day Stripe trial on the $38/mo membership price, then
// bills $38 on day 3 and monthly after. Built as Stripe's Checkout-native
// "legacy free trial + one-time fee" pattern: the recurring $38 is genuinely
// free during the 3-day trial (status=trialing), and the $1 one-time line
// item lands on the INITIAL invoice — so it's collected at checkout while
// only the recurring charge is deferred. (A true Stripe "Trial Offer" /
// two-phase schedule cannot be created through hosted Checkout.)
//
// Server-only: the trial fee only matters in the checkout actions and the
// webhook mirror, all server-side.

export const TRIAL_PERIOD_DAYS = 3;

// The amount actually transacted at checkout today is $1, not the $38
// membership (MEMBERSHIP_VALUE) — that isn't collected until day 3. This is
// the value we report to Meta / PostHog for InitiateCheckout, checkout_started
// AND the day-0 Purchase / subscribe_succeeded. Reporting $38 at trial start
// would overstate conversions for trials that cancel before day 3.
export const TRIAL_FEE_VALUE = 1;

// Spread into Checkout's subscription_data. trial_period_days defers ONLY the
// recurring $38; trial_settings is the safety net if the trial ever ends with
// no card on file (shouldn't happen — the $1 makes the checkout total
// non-zero so a card is always collected and payment_method_collection stays
// at its default "always"). `as const` keeps "cancel" a literal so it matches
// Stripe's missing_payment_method union without importing the param type.
export const TRIAL_SUBSCRIPTION_DATA = {
  trial_period_days: TRIAL_PERIOD_DAYS,
  trial_settings: {
    end_behavior: { missing_payment_method: "cancel" },
  },
} as const;

// Recurring $38/mo membership first (the headline product), then the one-time
// $1 trial fee. Stripe puts one-time prices on the initial invoice only, so
// the $1 is what's "due today" while the $38 starts after the trial.
export function checkoutLineItems(
  membershipPriceId: string,
  trialFeePriceId: string,
): Array<{ price: string; quantity: number }> {
  return [
    { price: membershipPriceId, quantity: 1 },
    { price: trialFeePriceId, quantity: 1 },
  ];
}
