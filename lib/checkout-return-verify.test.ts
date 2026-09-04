import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  paymentsOn: true,
  user: { stripeCustomerId: "cus_buyer" } as { stripeCustomerId: string | null } | null,
  retrieve: vi.fn(),
  mirror: vi.fn(),
}));
vi.mock("@/lib/free-mode", () => ({ paymentsEnabled: () => m.paymentsOn }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (m.user ? [m.user] : []) }),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({ users: { id: "id", stripeCustomerId: "sc" } }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { retrieve: m.retrieve } } }),
}));
vi.mock("@/lib/subscription-mirror", () => ({
  mirrorSubscription: (...a: unknown[]) => m.mirror(...a),
}));

import { verifyCheckoutReturn } from "./checkout-return-verify";

const paidSession = (over: Record<string, unknown> = {}) => ({
  mode: "subscription",
  status: "complete",
  payment_status: "paid",
  customer: "cus_buyer",
  subscription: { id: "sub_1", customer: "cus_buyer" },
  amount_total: 100,
  currency: "usd",
  ...over,
});

beforeEach(() => {
  m.paymentsOn = true;
  m.user = { stripeCustomerId: "cus_buyer" };
  m.retrieve.mockReset().mockResolvedValue(paidSession());
  m.mirror.mockReset().mockResolvedValue(undefined);
});

describe("verifyCheckoutReturn", () => {
  it("returns the buyer's subscription id + the real charge, and mirrors inline", async () => {
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toEqual({
      subscriptionId: "sub_1",
      amountCents: 100,
      currency: "usd",
    });
    expect(m.retrieve).toHaveBeenCalledWith("cs_test_1", { expand: ["subscription"] });
    expect(m.mirror).toHaveBeenCalledTimes(1);
  });

  it("refuses a session that belongs to another customer — conversions can't be forged", async () => {
    m.retrieve.mockResolvedValue(paidSession({ customer: "cus_someone_else" }));
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toBeNull();
    expect(m.mirror).not.toHaveBeenCalled();
  });

  it("refuses unpaid / incomplete / non-subscription sessions and Stripe errors", async () => {
    m.retrieve.mockResolvedValue(paidSession({ payment_status: "unpaid" }));
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toBeNull();
    m.retrieve.mockResolvedValue(paidSession({ status: "open" }));
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toBeNull();
    m.retrieve.mockResolvedValue(paidSession({ mode: "payment" }));
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toBeNull();
    m.retrieve.mockRejectedValue(new Error("no such session"));
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toBeNull();
    expect(m.mirror).not.toHaveBeenCalled();
  });

  it("never calls Stripe without payments, a user, or a well-formed id", async () => {
    m.paymentsOn = false;
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toBeNull();
    m.paymentsOn = true;
    await expect(verifyCheckoutReturn("cs_test_1", null)).resolves.toBeNull();
    await expect(verifyCheckoutReturn("forged", "user_1")).resolves.toBeNull();
    expect(m.retrieve).not.toHaveBeenCalled();
  });

  it("still reports the purchase when the inline mirror fails (webhook is the truth)", async () => {
    m.mirror.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(verifyCheckoutReturn("cs_test_1", "user_1")).resolves.toMatchObject({
      subscriptionId: "sub_1",
    });
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls[0])).not.toContain("cus_buyer");
    err.mockRestore();
  });
});
