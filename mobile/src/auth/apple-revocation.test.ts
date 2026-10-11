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
    user: "001234.dummy-linked",
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
  linkedAppleUserIds,
  needsAppleSheet,
  signedInWithApple,
} from "./apple-revocation";

const APPLE_USER = { externalAccounts: [{ provider: "google" }, { provider: "apple" }] };
// Apple's stable user identifier, as Clerk keeps it (`providerUserId`) and as
// the sheet returns it (`credential.user`) for the same Apple Account.
const LINKED = "001234.dummy-linked";

beforeEach(() => {
  apple.os = "ios";
  apple.available.mockReset().mockResolvedValue(true);
  apple.signIn
    .mockReset()
    .mockResolvedValue({ user: LINKED, authorizationCode: "c0de-dummy", identityToken: "id-dummy" });
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

describe("linkedAppleUserIds — the Apple Account(s) the Matio account is linked to", () => {
  it("Clerk's providerUserId of every Apple external account, nothing of any other provider", () => {
    expect(
      linkedAppleUserIds({
        externalAccounts: [
          { provider: "google", providerUserId: "google-dummy" },
          { provider: "apple", providerUserId: LINKED },
        ],
      }),
    ).toEqual([LINKED]);
  });

  it.each([
    ["an Apple account Clerk gave no id for", APPLE_USER],
    ["an empty id", { externalAccounts: [{ provider: "apple", providerUserId: "" }] }],
    ["Google only", { externalAccounts: [{ provider: "google", providerUserId: "google-dummy" }] }],
    ["no user", null],
  ])("%s → none", (_label, user) => {
    expect(linkedAppleUserIds(user)).toEqual([]);
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
    apple.signIn.mockResolvedValue({ user: LINKED, authorizationCode: null, identityToken: "id-dummy" });
    await expect(askAppleForDeletionCode()).resolves.toEqual({ status: "failed" });
  });
});

// Review of #427, finding 1: the sheet signs in with THIS device's Apple
// Account. A code for another one would revoke that account's grant on the
// server and log `revoked`, while the grant of the account Matio is linked to
// stays.
describe("askAppleForDeletionCode — the code must come from the linked Apple Account", () => {
  it("the linked Apple Account → its code", async () => {
    await expect(askAppleForDeletionCode([LINKED])).resolves.toEqual({ status: "code", code: "c0de-dummy" });
  });

  it("any of several linked Apple Accounts → its code", async () => {
    await expect(askAppleForDeletionCode(["001234.dummy-other-linked", LINKED])).resolves.toEqual({
      status: "code",
      code: "c0de-dummy",
    });
  });

  it("ANOTHER Apple Account's code is dropped — a failure, never a code to send", async () => {
    apple.signIn.mockResolvedValue({
      user: "009999.dummy-someone-else",
      authorizationCode: "c0de-of-another-account",
      identityToken: "id-dummy",
    });
    const answer = await askAppleForDeletionCode([LINKED]);
    expect(answer).toEqual({ status: "failed" });
    expect(JSON.stringify(answer)).not.toContain("c0de-of-another-account");
  });

  it("no linked id from Clerk does not block: the code goes as before", async () => {
    apple.signIn.mockResolvedValue({
      user: "009999.dummy-someone-else",
      authorizationCode: "c0de-dummy",
      identityToken: "id-dummy",
    });
    await expect(askAppleForDeletionCode([])).resolves.toEqual({ status: "code", code: "c0de-dummy" });
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
          setTimeout(() => resolve({ user: LINKED, authorizationCode: "c0de-slow", identityToken: "id-dummy" }), 90_000),
        ),
    );

    const state = track(askAppleForDeletionCode());
    await vi.advanceTimersByTimeAsync(90_000);

    expect(state).toEqual({ settled: true, answer: { status: "code", code: "c0de-slow" } });
  });
});
