import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  paymentsOn: true,
  userId: "user_1" as string | null,
  subscribed: true,
}));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => m.paymentsOn }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: m.userId }) }));
vi.mock("@/lib/subscription-access", () => ({
  hasActiveSubscription: async () => m.subscribed,
}));
vi.mock("@/lib/checkout-trial", () => ({ TRIAL_FEE_VALUE: 1 }));

import { CheckoutReturnBeacon } from "./checkout-return-beacon";
import { PurchasePixel } from "./purchase-pixel";

beforeEach(() => {
  m.paymentsOn = true;
  m.userId = "user_1";
  m.subscribed = true;
});

// The gate is three-fold and every leg must hold — a beacon that fires for a
// non-subscriber (webhook not yet mirrored) or a forged id would report a
// purchase that did not happen.
describe("CheckoutReturnBeacon", () => {
  it("mounts the purchase beacon for a mirrored subscriber with a valid session id", async () => {
    const el = await CheckoutReturnBeacon({ cs: "cs_test_ok" });
    expect(el?.type).toBe(PurchasePixel);
    expect(el?.props).toMatchObject({
      checkoutSessionId: "cs_test_ok",
      amountCents: 100,
      currency: "usd",
    });
  });

  it("renders nothing without payments, without a valid id, signed out, or unmirrored", async () => {
    m.paymentsOn = false;
    expect(await CheckoutReturnBeacon({ cs: "cs_test_ok" })).toBeNull();
    m.paymentsOn = true;
    expect(await CheckoutReturnBeacon({ cs: "forged" })).toBeNull();
    expect(await CheckoutReturnBeacon({ cs: undefined })).toBeNull();
    m.userId = null;
    expect(await CheckoutReturnBeacon({ cs: "cs_test_ok" })).toBeNull();
    m.userId = "user_1";
    m.subscribed = false;
    expect(await CheckoutReturnBeacon({ cs: "cs_test_ok" })).toBeNull();
  });
});
