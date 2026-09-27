import { beforeEach, describe, expect, it, vi } from "vitest";

// The device id rides on every /v1 call — including the ones a background or
// PiP episode makes behind a locked screen — so it lives in the keychain's
// AFTER_FIRST_UNLOCK class, like Clerk's JWT (#299). The keychain's default,
// WHEN_UNLOCKED, stops answering about a minute after the lock.

const AFTER_FIRST_UNLOCK = 0;

const keychain = vi.hoisted(() => ({
  values: new Map<string, string>(),
  calls: [] as { op: string; key: string; accessible: unknown }[],
  failReads: false,
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK,
  getItemAsync: async (key: string, o?: { keychainAccessible?: number }) => {
    keychain.calls.push({ op: "get", key, accessible: o?.keychainAccessible });
    if (keychain.failReads) throw new Error("errSecInteractionNotAllowed");
    return keychain.values.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string, o?: { keychainAccessible?: number }) => {
    keychain.calls.push({ op: "set", key, accessible: o?.keychainAccessible });
    keychain.values.set(key, value);
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-00000000000a",
}));

const KEY = "matio_device_id";
const STORED = "00000000-0000-4000-8000-00000000000b";

async function loadDevice() {
  vi.resetModules();
  return import("./device");
}

beforeEach(() => {
  keychain.values.clear();
  keychain.calls = [];
  keychain.failReads = false;
});

describe("getDeviceId", () => {
  it("mints once, writing the id in the AFTER_FIRST_UNLOCK class", async () => {
    const { getDeviceId } = await loadDevice();

    await expect(getDeviceId()).resolves.toBe("00000000-0000-4000-8000-00000000000a");
    expect(keychain.calls).toEqual([
      { op: "get", key: KEY, accessible: AFTER_FIRST_UNLOCK },
      { op: "set", key: KEY, accessible: AFTER_FIRST_UNLOCK },
    ]);
  });

  it("reads a stored id in the same class and serves it from memory afterwards", async () => {
    keychain.values.set(KEY, STORED);
    const { getDeviceId } = await loadDevice();

    await expect(getDeviceId()).resolves.toBe(STORED);
    await expect(getDeviceId()).resolves.toBe(STORED);
    expect(keychain.calls).toEqual([{ op: "get", key: KEY, accessible: AFTER_FIRST_UNLOCK }]);
  });

  it("degrades to no id — never a throw — when the keychain refuses", async () => {
    keychain.failReads = true;
    const { getDeviceId } = await loadDevice();

    await expect(getDeviceId()).resolves.toBeNull();
    expect(keychain.calls.some((c) => c.op === "set")).toBe(false);
  });
});
