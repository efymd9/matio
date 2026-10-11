import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #407 — «Delete account» for an account that signed in with Apple asks
// Apple's sheet once more for a fresh authorization code, which the server
// exchanges and revokes. The sheet sits between the two confirmations (the
// owner's option (а), PR #427), so its answer has three shapes the Account
// tab acts on: a code, a cancellation (stop — nothing is deleted), a failure
// (the final question says Apple stays connected). Apple's native module and
// the platform are faked; what is under test is when the sheet is asked at
// all, what is asked for, and which of the three answers comes back.
const apple = vi.hoisted(() => ({
  os: "ios",
  available: vi.fn(async () => true),
  signIn: vi.fn(async (_options?: unknown) => ({
    authorizationCode: "c0de-dummy" as string | null,
    identityToken: "id-dummy",
  })),
}));
vi.mock("expo-apple-authentication", () => ({
  isAvailableAsync: () => apple.available(),
  signInAsync: (options?: unknown) => apple.signIn(options),
}));
vi.mock("react-native", async (importOriginal) => {
  const rn = await importOriginal<typeof import("react-native")>();
  return {
    ...rn,
    Platform: {
      ...rn.Platform,
      get OS() {
        return apple.os;
      },
    },
  };
});

// The deadline is the /v1 client's own settleOrNull; that module reads
// Metro's __DEV__ at load, and its device-id half (the keychain) is not under
// test here.
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
vi.mock("@/api/device", () => ({ getDeviceId: async () => null }));

import {
  APPLE_SHEET_TIMEOUT_MS,
  type AppleDeletionCode,
  askAppleForDeletionCode,
  needsAppleSheet,
  signedInWithApple,
} from "./apple-revocation";

const APPLE_USER = { externalAccounts: [{ provider: "google" }, { provider: "apple" }] };

beforeEach(() => {
  apple.os = "ios";
  apple.available.mockReset().mockResolvedValue(true);
  apple.signIn.mockReset().mockResolvedValue({ authorizationCode: "c0de-dummy", identityToken: "id-dummy" });
});

describe("signedInWithApple — which accounts have an Apple grant to revoke", () => {
  it.each([
    ["an Apple external account", APPLE_USER, true],
    ["Google only", { externalAccounts: [{ provider: "google" }] }, false],
    ["an email-code account (no external accounts)", { externalAccounts: [] }, false],
    ["no user", null, false],
    ["a user Clerk has not filled in", {}, false],
  ])("%s → %s", (_label, user, expected) => {
    expect(signedInWithApple(user)).toBe(expected);
  });
});

describe("needsAppleSheet — whose deletion passes through Apple's sheet", () => {
  it("an Apple account on iOS", () => {
    expect(needsAppleSheet(APPLE_USER)).toBe(true);
  });

  it("never an account without Apple — its deletion keeps the two confirmations and nothing between", () => {
    expect(needsAppleSheet({ externalAccounts: [{ provider: "google" }] })).toBe(false);
    expect(needsAppleSheet({ externalAccounts: [] })).toBe(false);
    expect(needsAppleSheet(null)).toBe(false);
  });

  it("never off iOS — Android has no native Apple flow", () => {
    apple.os = "android";
    expect(needsAppleSheet(APPLE_USER)).toBe(false);
  });
});

describe("askAppleForDeletionCode", () => {
  it("a code from Apple's sheet — asked with no scopes: only the code is wanted", async () => {
    await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "code", code: "c0de-dummy" });
    expect(apple.signIn).toHaveBeenCalledTimes(1);
    expect(apple.signIn).toHaveBeenCalledWith({ requestedScopes: [] });
  });

  it("the person dismissing the sheet (ERR_REQUEST_CANCELED) is a cancellation — the deletion stops there", async () => {
    apple.signIn.mockRejectedValue(Object.assign(new Error("The user canceled"), { code: "ERR_REQUEST_CANCELED" }));
    await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "cancelled" });
  });

  it("any other Apple failure is a failure, not a cancellation", async () => {
    for (const code of ["ERR_REQUEST_FAILED", "ERR_REQUEST_UNKNOWN", "ERR_REQUEST_NOT_HANDLED", undefined]) {
      apple.signIn.mockRejectedValueOnce(Object.assign(new Error("failed"), { code }));
      await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "failed" });
    }
  });

  it("a device where Sign in with Apple is unavailable is a failure, without the sheet", async () => {
    apple.available.mockResolvedValue(false);
    await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "failed" });
    expect(apple.signIn).not.toHaveBeenCalled();
  });

  it("an availability check that rejects is a failure", async () => {
    apple.available.mockRejectedValue(new Error("native module missing"));
    await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "failed" });
    expect(apple.signIn).not.toHaveBeenCalled();
  });

  it("a credential without a code is a failure", async () => {
    apple.signIn.mockResolvedValue({ authorizationCode: null, identityToken: "id-dummy" });
    await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "failed" });
  });
});

describe("askAppleForDeletionCode — the sheet's deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function track(p: Promise<AppleDeletionCode>) {
    const state: { settled: boolean; answer?: AppleDeletionCode } = { settled: false };
    void p.then((answer) => {
      state.settled = true;
      state.answer = answer;
    });
    return state;
  }

  it("a sheet that never answers is a failure once the deadline passes — never a silent «go ahead», never held forever", async () => {
    apple.signIn.mockImplementation(() => new Promise<never>(() => {}));

    const state = track(askAppleForDeletionCode());
    await vi.advanceTimersByTimeAsync(APPLE_SHEET_TIMEOUT_MS - 1);
    expect(state.settled).toBe(false); // still the person's time at Face ID
    await vi.advanceTimersByTimeAsync(1);

    expect(state).toEqual({ settled: true, answer: { status: "failed" } });
  });

  it("an availability check that never answers is bounded by the same deadline", async () => {
    apple.available.mockImplementation(() => new Promise<never>(() => {}));

    const state = track(askAppleForDeletionCode());
    await vi.advanceTimersByTimeAsync(APPLE_SHEET_TIMEOUT_MS);

    expect(state).toEqual({ settled: true, answer: { status: "failed" } });
    expect(apple.signIn).not.toHaveBeenCalled();
  });

  it("is generous: a person who takes a minute and a half at the sheet still hands the server a code", async () => {
    apple.signIn.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ authorizationCode: "c0de-slow", identityToken: "id-dummy" }), 90_000),
        ),
    );

    const state = track(askAppleForDeletionCode());
    await vi.advanceTimersByTimeAsync(90_000);

    expect(state).toEqual({ settled: true, answer: { status: "code", code: "c0de-slow" } });
  });
});
