import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The dispatcher in front of the paywall's wallet button. Tiny, but it owns
// the one thing the client must never decide for itself: WHO the buyer is.
const h = vi.hoisted(() => ({
  authUserId: "user_1" as string | null,
  authCalls: [] as unknown[],
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.authUserId }),
}));

vi.mock("@/app/subscribe/actions", () => ({
  createAuthCheckoutSession: async () => ({ kind: "embedded" as const, clientSecret: "x" }),
  createAuthWalletCheckoutSession: async (
    input: unknown,
    consentAccepted: boolean,
  ) => {
    h.authCalls.push({ input, consentAccepted });
    return {
      kind: "wallet" as const,
      clientSecret: "cs_secret",
      sessionId: "cs_test_1",
      returnUrl: "https://matio.tv/watch/x?cs=cs_test_1",
    };
  },
}));

vi.mock("@/app/subscribe/guest-actions", () => ({
  createGuestCheckoutSession: async () => ({ kind: "redirect" as const, to: "/" }),
}));

// The refocus probe (#217): its one Stripe call, the users row it binds a
// signed-in caller to, and the checkout_claim cookie it binds a guest to.
const probe = vi.hoisted(() => ({
  retrieve: vi.fn(async (id: string) => ({ id, status: "open" })),
  // The Stripe session the fake returns — customer + client_reference_id are
  // what the binding compares against.
  session: {
    customer: "cus_mine" as string | { id: string } | null,
    client_reference_id: null as string | null,
    status: "open" as string,
  },
  userCustomerId: "cus_mine" as string | null,
  claimCookie: null as string | null,
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { retrieve: probe.retrieve } } }),
}));
vi.mock("@/db", () => {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () =>
      probe.userCustomerId === undefined
        ? []
        : [{ stripeCustomerId: probe.userCustomerId }],
  };
  return { db: { select: () => chain } };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "checkout_claim" && probe.claimCookie
        ? { value: probe.claimCookie }
        : undefined,
  }),
}));
vi.mock("@/lib/guest-checkout", () => ({ CHECKOUT_CLAIM_COOKIE: "checkout_claim" }));

import { checkoutSessionState, createWalletCheckoutSession } from "./actions";

const INPUT = { show: "the-scarlet-oath", ep: "ep-3", resume: null };

beforeEach(() => {
  h.authUserId = "user_1";
  h.authCalls = [];
  probe.session = { customer: "cus_mine", client_reference_id: null, status: "open" };
  probe.userCustomerId = "cus_mine";
  probe.claimCookie = null;
  probe.retrieve.mockReset().mockImplementation(async (id: string) => ({
    id,
    ...probe.session,
  }));
  vi.stubEnv("PAYMENTS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("checkoutSessionState — the /checkout tab's refocus probe (#217)", () => {
  it("answers closed for the signed-in buyer's own session once it is no longer open", async () => {
    probe.session.status = "expired";

    expect(await checkoutSessionState("cs_test_1")).toBe("closed");
    expect(probe.retrieve).toHaveBeenCalledWith("cs_test_1");
  });

  it("answers open for the buyer's own live session", async () => {
    expect(await checkoutSessionState("cs_test_1")).toBe("open");
  });

  it("answers open about SOMEBODY ELSE's session, even when that session is dead", async () => {
    // A signed-in caller probing a foreign `cs_…` learns nothing: the
    // session sits on another customer, so the answer is the neutral one.
    probe.session = { customer: "cus_theirs", client_reference_id: null, status: "expired" };

    expect(await checkoutSessionState("cs_test_1")).toBe("open");
  });

  it("binds a guest through the checkout_claim cookie — their own session answers its real status", async () => {
    // The pay-first buyer has no account and no customer of ours; the
    // session carries their claim token as client_reference_id (the same
    // check /welcome makes before minting a sign-in ticket).
    h.authUserId = null;
    probe.claimCookie = "claim-token-1";
    probe.session = {
      customer: null,
      client_reference_id: "claim-token-1",
      status: "expired",
    };

    expect(await checkoutSessionState("cs_test_1")).toBe("closed");
  });

  it("answers open for a guest whose cookie does not match the session", async () => {
    h.authUserId = null;
    probe.claimCookie = "claim-token-1";
    probe.session = {
      customer: null,
      client_reference_id: "claim-token-2",
      status: "expired",
    };

    expect(await checkoutSessionState("cs_test_1")).toBe("open");
  });

  it("answers open for an anonymous caller with no cookie — WITHOUT asking Stripe", async () => {
    // The cheap checks come first: nobody can use this action to make the
    // server look up arbitrary session ids on their behalf.
    h.authUserId = null;
    probe.claimCookie = null;

    expect(await checkoutSessionState("cs_test_1")).toBe("open");
    expect(probe.retrieve).not.toHaveBeenCalled();
  });

  it("answers open for a signed-in buyer with no Stripe customer yet and no cookie — without asking Stripe", async () => {
    // No customer means no session of ours can be theirs.
    probe.userCustomerId = null;

    expect(await checkoutSessionState("cs_test_1")).toBe("open");
    expect(probe.retrieve).not.toHaveBeenCalled();
  });

  it("answers open — leaving the form alone — when Stripe cannot be reached", async () => {
    // A failed probe must never tear down a form that works; the buyer's own
    // submit still tells the truth.
    probe.retrieve.mockRejectedValue(new Error("stripe down"));

    expect(await checkoutSessionState("cs_test_1")).toBe("open");
  });

  it("refuses an id that is not shaped like a session id, without asking Stripe", async () => {
    expect(await checkoutSessionState("<script>")).toBe("open");
    expect(probe.retrieve).not.toHaveBeenCalled();
  });

  it("answers open while payments are off, without asking Stripe", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");

    expect(await checkoutSessionState("cs_test_1")).toBe("open");
    expect(probe.retrieve).not.toHaveBeenCalled();
  });
});

describe("createWalletCheckoutSession", () => {
  it("redirects home while payments are off, without resolving auth", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");

    expect(await createWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(h.authCalls).toHaveLength(0);
  });

  it("answers unavailable for an anonymous buyer — v1 has no guest wallet path", async () => {
    // A signed-out wallet purchase would also mint a Clerk account and a
    // sign-in ticket from the wallet's email; that is a separate PR.
    h.authUserId = null;

    expect(await createWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(h.authCalls).toHaveLength(0);
  });

  it("dispatches a signed-in buyer to the wallet builder, consent flag intact", async () => {
    const res = await createWalletCheckoutSession(INPUT, true);

    expect(res).toMatchObject({ kind: "wallet", sessionId: "cs_test_1" });
    expect(h.authCalls).toEqual([{ input: INPUT, consentAccepted: true }]);
  });

  it("forwards a FALSE consent rather than quietly upgrading it", async () => {
    // The server-side builder is what refuses; the dispatcher must not paper
    // over an unticked box on the way through.
    await createWalletCheckoutSession(INPUT, false);

    expect(h.authCalls).toEqual([{ input: INPUT, consentAccepted: false }]);
  });
});
