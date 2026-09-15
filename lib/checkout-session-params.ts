import "server-only";
import type Stripe from "stripe";
import type { Locale } from "@/lib/i18n/dictionaries";

// The Checkout Session both flows create, in one place. Signed-in and guest
// checkout differ in exactly three fields (an existing customer, the address
// write-back that requires one, and the guest claim token); everything that
// decides WHAT IS SOLD and UNDER WHICH TERMS is identical, and drifting them
// apart is how a price or a consent box silently stops applying on one of the
// two paths.
//
// Since #207 the plan is a single line item — $25/mo charged at checkout.
// There is no trial period and no separate intro fee: a `trial_period_days`
// or a second line item appearing here would mean somebody is being charged
// something other than what the page promises.

// Which Stripe surface renders the session.
//   'embedded' — today's /checkout page (ui_mode 'embedded_page' or the hosted
//                fallback): Stripe renders the whole form, including the ToS
//                checkbox carrying our withdrawal waiver.
//   'elements'  — the wallet button on the paywall (ui_mode 'elements'): we
//                render the surface, so the two consent params below move to
//                our own UI. See the consent note on the builder.
export type CheckoutSurface = "embedded" | "elements";

export type CheckoutSessionInput = {
  /** The recurring membership price (STRIPE_PRICE_MONTHLY). */
  priceId: string;
  /** return_url (embedded) or success_url + cancel_url (hosted). */
  urlParams: Record<string, unknown>;
  /** Written onto the SUBSCRIPTION, where the webhook mirror reads it. */
  subscriptionMetadata: Record<string, string>;
  /** Checkout's own language. */
  locale: Locale;
  /** The EU/UK 14-day withdrawal waiver shown next to the ToS checkbox. */
  withdrawalWaiver: string;
  /** Signed-in flow only: the existing Stripe customer. */
  customerId?: string;
  /** Guest flow only: binds the session to the buyer's claim cookie. */
  clientReferenceId?: string;
  /** Which surface renders it. Defaults to today's Stripe-rendered form. */
  surface?: CheckoutSurface;
};

export function buildCheckoutSessionParams({
  priceId,
  urlParams,
  subscriptionMetadata,
  locale,
  withdrawalWaiver,
  customerId,
  clientReferenceId,
  surface = "embedded",
}: CheckoutSessionInput): Stripe.Checkout.SessionCreateParams {
  // The ToS consent pair is the ONLY thing that differs between surfaces, and
  // it differs because Stripe will not render it under `ui_mode: 'elements'`:
  //
  //   * `custom_text` is hard-rejected there — verified against the live API on
  //     the pinned 2026-04-22.dahlia: "The following parameters are not
  //     supported with `ui_mode: elements`: custom_text". So the localized
  //     waiver wording below simply cannot be sent.
  //   * `consent_collection` IS accepted, but its only renderer is Stripe's
  //     `TermsElement`, which the installed SDK marks "Requires beta access"
  //     and types with zero options — it could not carry our wording even with
  //     access, and a required-but-unrendered consent risks an unconfirmable
  //     session.
  //
  // So on the wallet surface WE collect it — one required checkbox that is
  // BOTH the Terms acceptance and the withdrawal waiver, in the buyer's
  // language, before the wallet sheet can open — and record which terms were
  // accepted in subscription metadata (see lib/wallet-checkout.ts, #214).
  // Dropping these two params is therefore not a loosening — the consent
  // moves, it does not disappear. Everything that decides WHAT IS SOLD stays identical, which is
  // what checkout-session-params.test.ts pins.
  const consentParams =
    surface === "elements"
      ? {}
      : {
          consent_collection: { terms_of_service: "required" as const },
          custom_text: {
            terms_of_service_acceptance: { message: withdrawalWaiver },
          },
        };

  return {
    mode: "subscription",
    // One line item, quantity one: the membership, charged today.
    line_items: [{ price: priceId, quantity: 1 }],
    ...(customerId ? { customer: customerId } : {}),
    // Stripe rejects customer_update without an existing customer; on the
    // guest path the collected address lands on the customer Stripe creates.
    ...(customerId
      ? { customer_update: { address: "auto" as const, name: "auto" as const } }
      : {}),
    ...(clientReferenceId ? { client_reference_id: clientReferenceId } : {}),
    ...urlParams,
    subscription_data: { metadata: subscriptionMetadata },
    // Stripe Tax — collect the billing address, compute VAT/sales tax and
    // persist it, so renewals invoice correctly. Without it EU/UK customers
    // were billed at the flat price with zero VAT, leaving the company liable.
    automatic_tax: { enabled: true },
    billing_address_collection: "required",
    // EU 14-day right-of-withdrawal waiver (Terms §5-6): the required ToS
    // checkbox links to the URL in the Stripe account's public details, and
    // custom_text replaces Stripe's default line with the digital-content
    // waiver, so the buyer expressly consents to immediate supply. Stripe
    // records the acceptance on the session. Works in embedded mode too — and
    // moves into our own UI on the 'elements' surface, see above.
    ...consentParams,
    locale,
  } as Stripe.Checkout.SessionCreateParams;
}
