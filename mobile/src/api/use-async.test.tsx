/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #313 — useAsync's silent `reload` hands back a promise, because Home's
// pull-to-refresh holds its spinner on it. The promise resolves once the
// refresh has settled — after a success AND after a failure — and never
// rejects: the foreground refreshes fire it and forget it, so a rejection
// would surface as an unhandled one. What is on screen stays on a failure,
// exactly as before.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});
// client.ts (for ApiError) pulls in the device id and the keychain.
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000000",
}));

import { useAsync } from "./use-async";

// The fetcher under the case's control: each call hands back a promise the
// case resolves or rejects when it chooses — or throws before returning one.
type Pending = { resolve: (value: string) => void; reject: (e: unknown) => void };
const pending: Pending[] = [];
let throwNext = false;
function fetcher(): Promise<string> {
  if (throwNext) {
    throwNext = false;
    throw new Error("thrown before a promise existed");
  }
  return new Promise<string>((resolve, reject) => {
    pending.push({ resolve, reject });
  });
}

type Hook = ReturnType<typeof useAsync<string>>;
let hook: Hook;
function Screen() {
  hook = useAsync(fetcher, []);
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Mounted, first load answered with "a": the list is on screen.
async function mountReady() {
  act(() => root.render(<Screen />));
  pending[0].resolve("a");
  await settle();
  expect(hook.status).toBe("ready");
  expect(hook.data).toBe("a");
}

// A reload started from outside React, as the RefreshControl callback does,
// with a flag that flips when its promise settles.
function startReload() {
  let reload: Promise<void> | undefined;
  act(() => {
    reload = hook.reload();
  });
  const settled = { value: false };
  if (!(reload instanceof Promise)) throw new Error("reload() returned no promise");
  void reload.then(() => {
    settled.value = true;
  });
  return { reload, settled };
}

beforeEach(() => {
  pending.length = 0;
  throwNext = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useAsync reload (#313)", () => {
  it("resolves only once a successful refresh has landed, with the new data on screen", async () => {
    await mountReady();

    const { reload, settled } = startReload();
    expect(pending).toHaveLength(2);
    await settle();
    expect(settled.value).toBe(false);

    await act(async () => {
      pending[1].resolve("b");
      await reload;
    });

    expect(settled.value).toBe(true);
    expect(hook.status).toBe("ready");
    expect(hook.data).toBe("b");
  });

  it("resolves — never rejects — after a failed refresh, and what is on screen stays", async () => {
    await mountReady();

    const { reload, settled } = startReload();
    await settle();
    expect(settled.value).toBe(false);

    let outcome: unknown = "pending";
    await act(async () => {
      pending[1].reject(new Error("network"));
      outcome = await reload.then(
        () => "resolved",
        () => "rejected",
      );
    });

    expect(outcome).toBe("resolved");
    expect(hook.status).toBe("ready");
    expect(hook.data).toBe("a");
  });

  it("a fetcher that throws before it returns a promise still settles the reload, without throwing", async () => {
    await mountReady();

    throwNext = true;
    const { reload } = startReload();
    await expect(reload).resolves.toBeUndefined();

    expect(hook.status).toBe("ready");
    expect(hook.data).toBe("a");
  });
});
