/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenCache } from "@clerk/expo";
import { closeStage, openStage, stillLive, type Stage } from "@/testing/stage";

// What AuthProvider hands Clerk and the fetch client (#299).
//
//   - The token cache Clerk keeps its client JWT in. Clerk reads that JWT
//     before every request it makes, including the ones a background or PiP
//     episode makes behind a locked screen (the hourly member-token refresh,
//     the next-episode prefetch) — so the item must be readable after the
//     lock (AFTER_FIRST_UNLOCK, not the keychain's default WHEN_UNLOCKED),
//     an item written by an older build must be re-created in that class
//     (a keychain update keeps the old one), Clerk must be able to delete it,
//     and a read may never land in the gap of a save's delete + add.
//   - The token provider the fetch client asks: a Clerk that failed to load
//     answers "nobody" at once instead of hanging every request for 3s.

const AFTER_FIRST_UNLOCK = 0;
const CLIENT_JWT_KEY = "__clerk_client_jwt";

// An async keychain with the real one's shape of time: every operation
// resolves on a later task, and a delete takes effect before it resolves —
// which is exactly the window a read must not see.
const keychain = vi.hoisted(() => ({
  values: new Map<string, string>(),
  log: [] as string[],
  failReads: false,
}));
vi.mock("expo-secure-store", () => {
  const later = () => new Promise((resolve) => setTimeout(resolve, 0));
  const opts = (o?: { keychainAccessible?: number }) =>
    o?.keychainAccessible === AFTER_FIRST_UNLOCK ? "AFTER_FIRST_UNLOCK" : "default";
  return {
    AFTER_FIRST_UNLOCK,
    getItemAsync: async (key: string, o?: { keychainAccessible?: number }) => {
      keychain.log.push(`get ${key} ${opts(o)}`);
      if (keychain.failReads) throw new Error("errSecInteractionNotAllowed");
      return keychain.values.get(key) ?? null;
    },
    setItemAsync: async (key: string, value: string, o?: { keychainAccessible?: number }) => {
      keychain.log.push(`set ${key} ${opts(o)}`);
      await later();
      keychain.values.set(key, value);
    },
    deleteItemAsync: async (key: string, o?: { keychainAccessible?: number }) => {
      keychain.log.push(`delete ${key} ${opts(o)}`);
      keychain.values.delete(key);
      await later();
    },
  };
});

// @clerk/expo as AuthProvider sees it: the provider records what it is given;
// the hooks answer from per-case state.
const clerkState = vi.hoisted(() => {
  const state = {
    tokenCache: null as TokenCache | null,
    status: "loading" as string,
    getToken: null as unknown as () => Promise<string | null>,
    // One object, like the provider's context value: a stable identity
    // across renders, and a status read at call time.
    clerk: {
      get status() {
        return state.status;
      },
    },
  };
  return state;
});
vi.mock("@clerk/expo", () => ({
  ClerkProvider: (props: { tokenCache: TokenCache; children: unknown }) => {
    clerkState.tokenCache = props.tokenCache;
    return props.children;
  },
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: clerkState.getToken }),
  useClerk: () => clerkState.clerk,
}));

const bridge = vi.hoisted(() => ({
  provider: undefined as undefined | null | (() => Promise<string | null>),
}));
vi.mock("@/api/client", () => ({
  setAuthTokenProvider: (provider: (() => Promise<string | null>) | null) => {
    bridge.provider = provider;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Each test's own container and root (#439 — see @/testing/stage).
let stage: Stage;

async function mountAuthProvider() {
  const own = stage;
  vi.resetModules();
  const { AuthProvider } = await import("./clerk");
  stillLive(own);
  act(() => own.root?.render(<AuthProvider>{null}</AuthProvider>));
  const cache = clerkState.tokenCache;
  if (!cache) throw new Error("ClerkProvider was not mounted");
  return cache;
}

beforeEach(() => {
  vi.stubGlobal("__DEV__", false);
  vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_dummy");
  keychain.values.clear();
  keychain.log = [];
  keychain.failReads = false;
  clerkState.tokenCache = null;
  clerkState.status = "ready";
  clerkState.getToken = vi.fn(async () => "sess_token");
  bridge.provider = undefined;
  stage = openStage();
  stage.root = createRoot(stage.container);
});

afterEach(() => {
  closeStage(stage);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the Clerk token cache — readable behind a locked screen", () => {
  it("reads the client JWT in the AFTER_FIRST_UNLOCK class", async () => {
    const cache = await mountAuthProvider();
    keychain.values.set(CLIENT_JWT_KEY, "client_jwt");

    await expect(cache.getToken(CLIENT_JWT_KEY)).resolves.toBe("client_jwt");
    expect(keychain.log).toEqual([`get ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`]);
  });

  it("saves by delete + add, both AFTER_FIRST_UNLOCK — an overwrite would keep an older build's WHEN_UNLOCKED item", async () => {
    const cache = await mountAuthProvider();
    keychain.values.set(CLIENT_JWT_KEY, "legacy_jwt");

    await cache.saveToken(CLIENT_JWT_KEY, "fresh_jwt");

    expect(keychain.log).toEqual([
      `delete ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`,
      `set ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`,
    ]);
    expect(keychain.values.get(CLIENT_JWT_KEY)).toBe("fresh_jwt");
  });

  it("lets Clerk remove the JWT (clearToken)", async () => {
    const cache = await mountAuthProvider();
    keychain.values.set(CLIENT_JWT_KEY, "client_jwt");

    expect(cache.clearToken).toBeTypeOf("function");
    await cache.clearToken?.(CLIENT_JWT_KEY);

    expect(keychain.values.has(CLIENT_JWT_KEY)).toBe(false);
    expect(keychain.log).toEqual([`delete ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`]);
  });

  it("answers null on a failed read and deletes nothing — a locked keychain is not a sign-out", async () => {
    const cache = await mountAuthProvider();
    keychain.values.set(CLIENT_JWT_KEY, "client_jwt");
    keychain.failReads = true;

    await expect(cache.getToken(CLIENT_JWT_KEY)).resolves.toBeNull();

    expect(keychain.values.get(CLIENT_JWT_KEY)).toBe("client_jwt");
    expect(keychain.log.some((line) => line.startsWith("delete"))).toBe(false);
  });

  it("never lets a read land between a save's delete and its add", async () => {
    const cache = await mountAuthProvider();
    keychain.values.set(CLIENT_JWT_KEY, "old_jwt");

    // Clerk saves the JWT from one response while its next request reads it.
    const save = cache.saveToken(CLIENT_JWT_KEY, "new_jwt");
    const read = cache.getToken(CLIENT_JWT_KEY);

    // A read in the gap would answer null, and Clerk would send a request
    // with no client JWT — answered with a new, signed-out client.
    await expect(read).resolves.toBe("new_jwt");
    await save;
    expect(keychain.log).toEqual([
      `delete ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`,
      `set ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`,
      `get ${CLIENT_JWT_KEY} AFTER_FIRST_UNLOCK`,
    ]);
  });

  it("keeps serving after a failed operation — one bad turn does not wedge the key", async () => {
    const cache = await mountAuthProvider();
    keychain.values.set(CLIENT_JWT_KEY, "client_jwt");
    keychain.failReads = true;
    await expect(cache.getToken(CLIENT_JWT_KEY)).resolves.toBeNull();

    keychain.failReads = false;
    await expect(cache.getToken(CLIENT_JWT_KEY)).resolves.toBe("client_jwt");
  });
});

describe("the token provider AuthBridge installs in the fetch client", () => {
  it("asks Clerk for the session token while Clerk is healthy", async () => {
    await mountAuthProvider();

    expect(bridge.provider).toBeTypeOf("function");
    await expect(bridge.provider?.()).resolves.toBe("sess_token");
    expect(clerkState.getToken).toHaveBeenCalledTimes(1);
  });

  it("answers null at once when Clerk failed to load — getToken would wait for a load that is not coming", async () => {
    clerkState.getToken = vi.fn(() => new Promise<never>(() => {}));
    await mountAuthProvider();
    clerkState.status = "error";

    await expect(bridge.provider?.()).resolves.toBeNull();
    expect(clerkState.getToken).not.toHaveBeenCalled();
  });

  it("reads Clerk's status per call, so a recovered Clerk is asked again", async () => {
    clerkState.status = "error";
    await mountAuthProvider();
    await expect(bridge.provider?.()).resolves.toBeNull();

    clerkState.status = "ready";
    await expect(bridge.provider?.()).resolves.toBe("sess_token");
  });

  it("takes the provider away on unmount", async () => {
    await mountAuthProvider();
    expect(bridge.provider).toBeTypeOf("function");

    act(() => stage.root?.render(null));

    expect(bridge.provider).toBeNull();
  });
});
