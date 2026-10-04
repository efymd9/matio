import { afterEach, describe, expect, it, vi } from "vitest";

// #277 — ending the Google sign-in SDK's own session (kept in the keychain,
// untouched by Clerk's signOut) before the Account tab signs out. The native
// module is reached by name through `expo`, exactly as @clerk/expo reaches
// it; here it is a spy a case scripts.
const native = vi.hoisted(() => ({
  names: [] as string[],
  module: null as null | { signOut: () => Promise<void> },
}));
vi.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) => {
    native.names.push(name);
    return native.module;
  },
}));

import { endGoogleSession, GOOGLE_SIGN_OUT_TIMEOUT_MS } from "./google-session";

afterEach(() => {
  native.names.length = 0;
  native.module = null;
  vi.useRealTimers();
});

describe("endGoogleSession", () => {
  it("signs the Google SDK out through @clerk/expo-google-signin's module", async () => {
    const signOut = vi.fn(async () => undefined);
    native.module = { signOut };

    await endGoogleSession();

    expect(native.names).toEqual(["ClerkGoogleSignIn"]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("a build without the module simply has nothing to end", async () => {
    await expect(endGoogleSession()).resolves.toBeUndefined();
    expect(native.names).toEqual(["ClerkGoogleSignIn"]);
  });

  it("a failing sign-out never stands between the viewer and signing out", async () => {
    native.module = { signOut: async () => Promise.reject(new Error("GIDSignIn failed")) };

    await expect(endGoogleSession()).resolves.toBeUndefined();
  });

  it("an answer that never comes is given up after its budget", async () => {
    vi.useFakeTimers();
    native.module = { signOut: () => new Promise<void>(() => {}) };

    let settled = false;
    const done = endGoogleSession().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(GOOGLE_SIGN_OUT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
  });
});
