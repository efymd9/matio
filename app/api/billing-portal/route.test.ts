import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// /api/billing-portal answers with a redirect on EVERY branch, and every one
// of them is a statement about one person — signed in or not, has a Stripe
// customer or not. None of that may be stored: not by the browser, not by
// anything between it and us. Before #266 only the Stripe branch said so.
//
// Everything the route reaches for is faked; what is under test is where each
// branch sends the viewer and the Cache-Control it carries. No Stripe call is
// ever made — `create` is a vi.fn.
const h = vi.hoisted(() => ({
  user: null as { id: string; stripeCustomerId: string | null } | null,
  paymentsOn: true,
  create: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({
  getOrSyncCurrentUser: async () => h.user,
}));
vi.mock("@/lib/free-mode", () => ({
  paymentsEnabled: () => h.paymentsOn,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: h.create } } }),
}));

import { GET } from "./route";

const ORIGIN = "https://matio.test";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  h.user = null;
  h.paymentsOn = true;
  h.create.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/billing-portal — no redirect is ever cacheable (#266)", () => {
  it("anonymous: home, no-store, and Stripe is never asked", async () => {
    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("signed in without a Stripe customer, payments on: /subscribe, no-store", async () => {
    h.user = { id: "user_1", stripeCustomerId: null };

    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/subscribe`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("signed in without a Stripe customer, payments off: home (no double hop), no-store", async () => {
    // /subscribe itself bounces home in free mode — the route skips that hop.
    h.user = { id: "user_1", stripeCustomerId: null };
    h.paymentsOn = false;

    const res = await GET();

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("with a Stripe customer: the portal session's own URL, no-store", async () => {
    h.user = { id: "user_1", stripeCustomerId: "cus_dummy" };
    h.create.mockResolvedValue({
      url: "https://billing.stripe.test/p/session/dummy",
    });

    const res = await GET();

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create).toHaveBeenCalledWith({
      customer: "cus_dummy",
      return_url: `${ORIGIN}/`,
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://billing.stripe.test/p/session/dummy",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
