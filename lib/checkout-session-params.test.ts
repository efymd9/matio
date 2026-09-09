import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildCheckoutSessionParams } from "./checkout-session-params";

// What is sold, and on what terms. These assertions are the contract with the
// price on the page: since #207 a single $25/mo line item charged today, no
// trial, no second fee. A change here without a change to the copy means
// somebody gets billed something they were not shown.
const base = {
  priceId: "price_monthly",
  urlParams: { return_url: "https://matio.tv/welcome" },
  subscriptionMetadata: { userId: "user_1" },
  locale: "en" as const,
  withdrawalWaiver: "I request immediate supply…",
};

describe("buildCheckoutSessionParams", () => {
  it("sells exactly one thing: the membership, quantity one", () => {
    const p = buildCheckoutSessionParams(base);

    expect(p.line_items).toEqual([{ price: "price_monthly", quantity: 1 }]);
    expect(p.mode).toBe("subscription");
  });

  it("charges today — no trial period and no trial settings anywhere", () => {
    const p = buildCheckoutSessionParams(base);

    // The whole point of #207: nothing defers the charge.
    expect(JSON.stringify(p)).not.toContain("trial");
    expect(p.subscription_data).toEqual({ metadata: { userId: "user_1" } });
  });

  it("keeps tax and the withdrawal waiver on both flows", () => {
    for (const extra of [{ customerId: "cus_1" }, { clientReferenceId: "tok" }]) {
      const p = buildCheckoutSessionParams({ ...base, ...extra });

      expect(p.automatic_tax).toEqual({ enabled: true });
      expect(p.billing_address_collection).toBe("required");
      expect(p.consent_collection).toEqual({ terms_of_service: "required" });
      // Stripe types the field as "" | { message }, so narrow before reading.
      const tos = p.custom_text?.terms_of_service_acceptance;
      expect(typeof tos === "object" && tos?.message).toBe(
        base.withdrawalWaiver,
      );
      expect(p.locale).toBe("en");
    }
  });

  it("attaches the customer and the address write-back only when signed in", () => {
    const signedIn = buildCheckoutSessionParams({ ...base, customerId: "cus_1" });
    expect(signedIn.customer).toBe("cus_1");
    expect(signedIn.customer_update).toEqual({ address: "auto", name: "auto" });

    // Stripe rejects customer_update with no customer — the guest flow must
    // not send either.
    const guest = buildCheckoutSessionParams({ ...base, clientReferenceId: "tok" });
    expect(guest.customer).toBeUndefined();
    expect(guest.customer_update).toBeUndefined();
    expect(guest.client_reference_id).toBe("tok");
  });

  it("passes the return/success urls through untouched", () => {
    const hosted = buildCheckoutSessionParams({
      ...base,
      urlParams: {
        success_url: "https://matio.tv/ok",
        cancel_url: "https://matio.tv/no",
      },
    });

    expect(hosted).toMatchObject({
      success_url: "https://matio.tv/ok",
      cancel_url: "https://matio.tv/no",
    });
  });

  it("hands the subscription metadata to the SUBSCRIPTION, where the webhook reads it", () => {
    const p = buildCheckoutSessionParams({
      ...base,
      subscriptionMetadata: { guest: "1", claim_token: "tok" },
    });

    expect(p.subscription_data?.metadata).toEqual({
      guest: "1",
      claim_token: "tok",
    });
    // Not on the session: the mirror reads subscription metadata only.
    expect(p.metadata).toBeUndefined();
  });
});
