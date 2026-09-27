/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppState } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContinueResponse, ContinueWatchingEntry } from "@/shared/api-types";

// #298 — the continue-watching list behind Home's «Up next» and the Account
// tab. The app stays in memory for days and Home stays mounted under the
// other tabs, so three things are pinned here: (1) a sign-out drops the list
// even while Home is not focused, and the next account's first focus loads
// its own — never the previous account's positions; (2) a failed load is not
// the end of it: the next focus or return to the foreground tries again, and
// a return to the foreground refreshes the list anyway; (3) only the newest
// load writes — an older answer neither overwrites a newer one nor puts a
// signed-out account's list back.

// Navigation focus, as expo-router's useFocusEffect delivers it: the effect
// runs on focus (and at once when mounted focused, or re-created while
// focused), its cleanup on blur and unmount; a re-created effect does NOT run
// while blurred (the orientation suite's fake).
const nav = vi.hoisted(() => {
  const listeners = new Set<(focused: boolean) => void>();
  return {
    focused: true,
    listeners,
    set(focused: boolean) {
      nav.focused = focused;
      listeners.forEach((listener) => listener(focused));
    },
  };
});

vi.mock("expo-router", async () => {
  const React = await import("react");
  return {
    useFocusEffect(effect: () => undefined | (() => void)) {
      React.useEffect(() => {
        let cleanup: undefined | (() => void);
        let isFocused = false;
        const run = () => {
          cleanup = effect();
          isFocused = true;
        };
        if (nav.focused) run();
        const listener = (focused: boolean) => {
          if (focused) {
            if (isFocused) return;
            cleanup?.();
            run();
          } else {
            cleanup?.();
            cleanup = undefined;
            isFocused = false;
          }
        };
        nav.listeners.add(listener);
        return () => {
          cleanup?.();
          nav.listeners.delete(listener);
        };
      }, [effect]);
    },
  };
});

// GET /v1/continue under the case's control: each call hands back a promise
// the case resolves or rejects when it chooses.
type Pending = { resolve: (res: ContinueResponse) => void; reject: (e: unknown) => void };
const pending = vi.hoisted(() => [] as Pending[]);
vi.mock("@/api/client", () => ({
  api: {
    continueWatching: () =>
      new Promise<ContinueResponse>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  },
}));

// The player's "a save landed" signal, fired by the case.
const saved = vi.hoisted(() => new Set<() => void>());
vi.mock("./use-progress-saver", () => ({
  onProgressSaved(listener: () => void) {
    saved.add(listener);
    return () => {
      saved.delete(listener);
    };
  },
}));

import { useContinueWatching } from "./use-continue-watching";

function entry(episodeId: string): ContinueWatchingEntry {
  return {
    show: {
      slug: `show-${episodeId}`,
      title: episodeId,
      orientation: "horizontal",
      posterImageUrl: null,
      heroImageUrl: null,
    },
    episodeId,
    episodeNumber: 1,
    episodeTitle: episodeId,
    positionSeconds: 600,
    durationSeconds: 1200,
    fraction: 0.5,
    updatedAt: "2026-09-27T10:00:00.000Z",
  };
}

// Every list the screen rendered, in order: "ep,ep".
let rendered: string[] = [];
function Home({ signedIn }: { signedIn: boolean }) {
  const items = useContinueWatching(signedIn);
  rendered.push(items.map((i) => i.episodeId).join(","));
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const appState = new Set<(state: string) => void>();

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render(signedIn: boolean) {
  act(() => root.render(<Home signedIn={signedIn} />));
  await settle();
}

async function answer(index: number, ...episodeIds: string[]) {
  pending[index].resolve({ items: episodeIds.map(entry) });
  await settle();
}

async function fail(index: number) {
  pending[index].reject(new Error("network"));
  await settle();
}

async function blur() {
  act(() => nav.set(false));
  await settle();
}

async function focus() {
  act(() => nav.set(true));
  await settle();
}

async function foreground(state = "active") {
  act(() => appState.forEach((listener) => listener(state)));
  await settle();
}

async function progressSaved() {
  act(() => saved.forEach((listener) => listener()));
  await settle();
}

const shown = () => rendered[rendered.length - 1];

beforeEach(() => {
  nav.focused = true;
  nav.listeners.clear();
  pending.length = 0;
  saved.clear();
  appState.clear();
  rendered = [];
  vi.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    const listener = handler as (state: string) => void;
    appState.add(listener);
    return { remove: () => appState.delete(listener) } as ReturnType<typeof AppState.addEventListener>;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("useContinueWatching — a change of account (#298 item 1)", () => {
  it("a sign-out and a sign-in while Home is unfocused: the next focus loads the new account's list", async () => {
    await render(true);
    await answer(0, "a-ep");
    expect(shown()).toBe("a-ep");

    // Account tab: A signs out, B signs in; Home is mounted but not focused.
    await blur();
    await render(false);
    expect(shown()).toBe("");
    const signedOutAt = rendered.length;
    await render(true);
    expect(pending).toHaveLength(1);

    await focus();
    expect(pending).toHaveLength(2);
    await answer(1, "b-ep");

    expect(shown()).toBe("b-ep");
    expect(rendered.slice(signedOutAt).some((list) => list.includes("a-ep"))).toBe(false);
  });

  it("an answer for the signed-out account that lands late is dropped", async () => {
    await render(true);
    await render(false);
    await answer(0, "a-ep");

    expect(shown()).toBe("");
    expect(rendered).not.toContain("a-ep");
  });

  it("a sign-in while Home is focused loads straight away and keeps the answer", async () => {
    await render(false);
    expect(pending).toHaveLength(0);

    await render(true);
    expect(pending).toHaveLength(1);
    await answer(0, "b-ep");

    expect(shown()).toBe("b-ep");
  });
});

describe("useContinueWatching — retry and foreground refresh (#298 item 2)", () => {
  it("a failed first load is retried on the next focus", async () => {
    await render(true);
    await fail(0);
    expect(shown()).toBe("");

    await blur();
    await focus();

    expect(pending).toHaveLength(2);
    await answer(1, "a-ep");
    expect(shown()).toBe("a-ep");
  });

  it("a failed first load is retried on the return to the foreground", async () => {
    await render(true);
    await fail(0);

    await foreground();

    expect(pending).toHaveLength(2);
    await answer(1, "a-ep");
    expect(shown()).toBe("a-ep");
  });

  it("a failed refresh keeps what is on screen, and the next focus tries again", async () => {
    await render(true);
    await answer(0, "a-ep");

    await foreground();
    await fail(1);
    expect(shown()).toBe("a-ep");

    await blur();
    await focus();
    expect(pending).toHaveLength(3);
  });

  it("a return to the foreground refreshes the list on screen", async () => {
    await render(true);
    await answer(0, "a-ep");

    await foreground("inactive");
    await foreground("background");
    expect(pending).toHaveLength(1);

    await foreground();
    expect(pending).toHaveLength(2);
    await answer(1, "a-ep", "web-ep");
    expect(shown()).toBe("a-ep,web-ep");
  });

  it("a return to the foreground while unfocused waits for the focus", async () => {
    await render(true);
    await answer(0, "a-ep");
    await blur();

    await foreground();
    expect(pending).toHaveLength(1);

    await focus();
    expect(pending).toHaveLength(2);
  });

  it("a signed-out viewer asks for nothing on the return to the foreground", async () => {
    await render(false);
    await foreground();
    await blur();
    await focus();

    expect(pending).toHaveLength(0);
  });

  it("a save while the player is open refreshes on the next focus, not before", async () => {
    await render(true);
    await answer(0, "a-ep");
    await blur();

    await progressSaved();
    expect(pending).toHaveLength(1);

    await focus();
    expect(pending).toHaveLength(2);
  });
});

describe("useContinueWatching — only the newest load writes (#298 item 2)", () => {
  it("an older answer landing after a newer one does not overwrite it", async () => {
    await render(true);
    await foreground();
    expect(pending).toHaveLength(2);

    await answer(1, "new-ep");
    await answer(0, "old-ep");

    expect(shown()).toBe("new-ep");
  });

  it("an older failure does not force a reload after a newer success", async () => {
    await render(true);
    await foreground();
    await answer(1, "new-ep");
    await fail(0);

    await blur();
    await focus();

    expect(pending).toHaveLength(2);
    expect(shown()).toBe("new-ep");
  });
});
