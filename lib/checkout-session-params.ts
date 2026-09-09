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
};

export function buildCheckoutSessionParams({
  priceId,
  urlParams,
  subscriptionMetadata,
  locale,
  withdrawalWaiver,
  customerId,
  clientReferenceId,
}: CheckoutSessionInput): Stripe.Checkout.SessionCreateParams {
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
    // records the acceptance on the session. Works in embedded mode too.
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: { message: withdrawalWaiver },
    },
    locale,
  } as Stripe.Checkout.SessionCreateParams;
}
