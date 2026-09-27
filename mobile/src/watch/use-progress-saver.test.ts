/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppState } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveProgressRequest } from "@/shared/api-types";

// #300 — a progress save that FAILS used to be recorded as saved: the dedupe
// then swallowed every later flush at the same position, so the playhead a
// viewer paused on in a dead zone never reached the server, and a failed
// `ended` save never marked the episode completed (it stayed on Up next and
// resumed in the credits). Pinned here: a failed save is sent again by the
// next flush — unmount, background, or the return to the foreground — and a
// failed `ended` save is sent again AS completed; the Home rail's
// "a save landed" signal fires on a landed save only.

type Call = { body: SaveProgressRequest; resolve: () => void; reject: (err: unknown) => void };
const server = vi.hoisted(() => ({ calls: [] as Call[] }));

vi.mock("@/api/client", () => ({
  api: {
    saveProgress: (body: SaveProgressRequest) =>
      new Promise((resolve, reject) => {
        server.calls.push({ body, resolve: () => resolve({ ok: true }), reject });
      }),
  },
}));

import { onProgressSaved, useProgressSaver } from "./use-progress-saver";

type Saver = ReturnType<typeof useProgressSaver>;
let saver: Saver;
function Harness({ enabled }: { enabled: boolean }) {
  saver = useProgressSaver("ep1", enabled);
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let mounted = false;
let onAppState: ((state: string) => void) | null = null;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function mount() {
  act(() => root.render(createElement(Harness, { enabled: true })));
  mounted = true;
}

function unmount() {
  act(() => root.unmount());
  mounted = false;
}

function appState(next: string) {
  act(() => onAppState?.(next));
}

async function fail() {
  server.calls[server.calls.length - 1].reject(new Error("offline"));
  await settle();
}

async function succeed() {
  server.calls[server.calls.length - 1].resolve();
  await settle();
}

// Every save sent, in order: "position" or "position:completed".
const sent = () =>
  server.calls.map((c) => `${c.body.positionSeconds}${c.body.completed ? ":completed" : ""}`);

beforeEach(() => {
  vi.useFakeTimers();
  server.calls = [];
  onAppState = null;
  vi.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    const listener = handler as (state: string) => void;
    onAppState = listener;
    return {
      remove: () => {
        if (onAppState === listener) onAppState = null;
      },
    } as ReturnType<typeof AppState.addEventListener>;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (mounted) unmount();
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useProgressSaver — a failed save is not a saved one (#300)", () => {
  it("resends a failed background flush from the unmount flush", async () => {
    mount();
    act(() => saver.onProgress(754.6));
    appState("background");
    expect(sent()).toEqual(["754"]);
    await fail();

    unmount();
    expect(sent()).toEqual(["754", "754"]);
    expect(server.calls[1].body).toEqual({ episodeId: "ep1", positionSeconds: 754, completed: false });
  });

  it("resends a failed background flush when the app returns to the foreground", async () => {
    mount();
    act(() => saver.onProgress(754.6));
    appState("background");
    await fail();

    appState("active");
    expect(sent()).toEqual(["754", "754"]);
    await succeed();

    // Landed: the same position is not sent a third time.
    unmount();
    expect(sent()).toEqual(["754", "754"]);
  });

  it("does not resend a position that landed", async () => {
    mount();
    act(() => saver.onProgress(754.6));
    appState("background");
    await succeed();

    appState("active");
    unmount();
    expect(sent()).toEqual(["754"]);
  });

  it("leaves a newer save's record alone when an older one fails", async () => {
    mount();
    act(() => saver.onProgress(750));
    appState("inactive"); // 750 on the wire
    act(() => saver.onProgress(760));
    appState("background"); // 760 on the wire
    server.calls[1].resolve();
    await settle();
    server.calls[0].reject(new Error("offline"));
    await settle();

    unmount();
    expect(sent()).toEqual(["750", "760"]);
  });

  it("resends a failed `ended` save as completed=true from the unmount flush", async () => {
    mount();
    act(() => saver.onProgress(600.2));
    act(() => saver.onEnded());
    expect(sent()).toEqual(["600:completed"]);
    await fail();

    unmount();
    expect(sent()).toEqual(["600:completed", "600:completed"]);
    expect(server.calls[1].body).toEqual({ episodeId: "ep1", positionSeconds: 600, completed: true });
  });

  it("resends a failed `ended` save as completed=true from a background flush — once for the inactive/background pair", async () => {
    mount();
    act(() => saver.onProgress(600.2));
    act(() => saver.onEnded());
    await fail();

    appState("inactive");
    appState("background");
    expect(sent()).toEqual(["600:completed", "600:completed"]);
    await succeed();

    // Landed: nothing is owed any more.
    appState("active");
    unmount();
    expect(sent()).toEqual(["600:completed", "600:completed"]);
  });

  it("drops the owed completed=true when the viewer replays the episode", async () => {
    mount();
    act(() => saver.onProgress(600.2));
    act(() => saver.onEnded());
    await fail();

    act(() => saver.onProgress(30)); // scrubbed back: live again
    unmount();
    expect(sent()).toEqual(["600:completed", "30"]);
  });
});

describe("useProgressSaver — the Home rail learns of landed saves only", () => {
  it("fires onProgressSaved on success, never on failure", async () => {
    const heard = vi.fn();
    const stop = onProgressSaved(heard);
    try {
      mount();
      act(() => saver.onProgress(120));
      appState("background");
      await fail();
      expect(heard).not.toHaveBeenCalled();

      act(() => saver.onProgress(130));
      appState("background");
      await succeed();
      expect(heard).toHaveBeenCalledTimes(1);

      act(() => saver.onEnded());
      await fail();
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });
});
