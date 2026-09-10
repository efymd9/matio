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
    waiverAccepted: boolean,
  ) => {
    h.authCalls.push({ input, waiverAccepted });
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

import { createWalletCheckoutSession } from "./actions";

const INPUT = { show: "the-scarlet-oath", ep: "ep-3", resume: null };

beforeEach(() => {
  h.authUserId = "user_1";
  h.authCalls = [];
  vi.stubEnv("PAYMENTS_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

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

  it("dispatches a signed-in buyer to the wallet builder, waiver flag intact", async () => {
    const res = await createWalletCheckoutSession(INPUT, true);

    expect(res).toMatchObject({ kind: "wallet", sessionId: "cs_test_1" });
    expect(h.authCalls).toEqual([{ input: INPUT, waiverAccepted: true }]);
  });

  it("forwards a FALSE waiver rather than quietly upgrading it", async () => {
    // The server-side builder is what refuses; the dispatcher must not paper
    // over an unticked box on the way through.
    await createWalletCheckoutSession(INPUT, false);

    expect(h.authCalls).toEqual([{ input: INPUT, waiverAccepted: false }]);
  });
});
