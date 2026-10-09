import { beforeEach, describe, expect, it, vi } from "vitest";

// #407 — «Delete account» for an account that signed in with Apple asks
// Apple's sheet once more for a fresh authorization code, which the server
// exchanges and revokes. Apple's native module and the platform are faked;
// what is under test is when the sheet is asked at all, what is asked for,
// and that nothing here can stop the deletion.
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

import { appleCodeForDeletion, signedInWithApple } from "./apple-revocation";

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

describe("appleCodeForDeletion", () => {
  it("asks Apple's sheet for a code — with no scopes: only the code is wanted", async () => {
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBe("c0de-dummy");
    expect(apple.signIn).toHaveBeenCalledTimes(1);
    expect(apple.signIn).toHaveBeenCalledWith({ requestedScopes: [] });
  });

  it("never shows the sheet to an account without Apple", async () => {
    await expect(appleCodeForDeletion({ externalAccounts: [{ provider: "google" }] })).resolves.toBeUndefined();
    expect(apple.available).not.toHaveBeenCalled();
    expect(apple.signIn).not.toHaveBeenCalled();
  });

  it("never asks off iOS — Android has no native Apple flow", async () => {
    apple.os = "android";
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBeUndefined();
    expect(apple.signIn).not.toHaveBeenCalled();
  });

  it("a device where Sign in with Apple is unavailable answers no code, without the sheet", async () => {
    apple.available.mockResolvedValue(false);
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBeUndefined();
    expect(apple.signIn).not.toHaveBeenCalled();
  });

  it("a cancelled sheet (ERR_REQUEST_CANCELED) is no code — not a failure that could stop the deletion", async () => {
    apple.signIn.mockRejectedValue(Object.assign(new Error("The user canceled"), { code: "ERR_REQUEST_CANCELED" }));
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBeUndefined();
  });

  it("any other Apple failure, or an unanswerable availability check, is no code too", async () => {
    apple.signIn.mockRejectedValue(Object.assign(new Error("failed"), { code: "ERR_REQUEST_FAILED" }));
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBeUndefined();

    apple.available.mockRejectedValue(new Error("native module missing"));
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBeUndefined();
  });

  it("a credential without a code is no code", async () => {
    apple.signIn.mockResolvedValue({ authorizationCode: null, identityToken: "id-dummy" });
    await expect(appleCodeForDeletion(APPLE_USER)).resolves.toBeUndefined();
  });
});
