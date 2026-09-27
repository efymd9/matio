/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppState } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WATCH_SEGMENT_FLUSH_MAX_BUCKETS } from "@/shared/api-types";

// #300 — the retention-bucket tracker in front of the offline queue, held to
// the web player's semantics: continuous playback marks a 10s bucket once, a
// seek re-arms it (the rewatch peak on the admin curve), and the pending set
// is handed to the queue every 20s, on AppState → background / inactive, at
// `ended` and on unmount — never lost with the page.

const queue = vi.hoisted(() => ({ flushes: [] as string[] }));
vi.mock("./segment-queue", () => ({
  enqueueWatchSegments: (episodeId: string, buckets: number[]) => {
    queue.flushes.push(`${episodeId}:${[...buckets].sort((a, b) => a - b).join(",")}`);
  },
}));

import { SEGMENT_FLUSH_INTERVAL_MS, useSegmentTracker } from "./use-segment-tracker";

let tracker: ReturnType<typeof useSegmentTracker>;
function Harness({ enabled }: { enabled: boolean }) {
  tracker = useSegmentTracker("ep1", enabled);
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let mounted = false;
let onAppState: ((state: string) => void) | null = null;

function mount(enabled = true) {
  act(() => root.render(createElement(Harness, { enabled })));
  mounted = true;
}

function unmount() {
  act(() => root.unmount());
  mounted = false;
}

// Playback samples, as the player's onProgress delivers them.
function play(...seconds: number[]) {
  act(() => {
    for (const t of seconds) tracker.onProgress(t);
  });
}

async function after(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  queue.flushes = [];
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

describe("useSegmentTracker — when the buckets go to the queue", () => {
  it("flushes every 20s, and only what was marked since the last flush", async () => {
    mount();
    play(0, 4, 9.9, 10, 15, 21);

    await after(SEGMENT_FLUSH_INTERVAL_MS - 1);
    expect(queue.flushes).toEqual([]);
    await after(1);
    expect(queue.flushes).toEqual(["ep1:0,1,2"]);

    // Nothing new: the next tick sends nothing.
    await after(SEGMENT_FLUSH_INTERVAL_MS);
    expect(queue.flushes).toEqual(["ep1:0,1,2"]);

    play(29, 30);
    await after(SEGMENT_FLUSH_INTERVAL_MS);
    expect(queue.flushes).toEqual(["ep1:0,1,2", "ep1:3"]);
  });

  it("flushes at once on background and on inactive, not on the return to the foreground", async () => {
    mount();
    play(35);
    act(() => onAppState?.("background"));
    expect(queue.flushes).toEqual(["ep1:3"]);

    play(41);
    act(() => onAppState?.("inactive"));
    expect(queue.flushes).toEqual(["ep1:3", "ep1:4"]);

    play(52);
    act(() => onAppState?.("active"));
    expect(queue.flushes).toEqual(["ep1:3", "ep1:4"]);
  });

  it("flushes on unmount and at `ended`", async () => {
    mount();
    play(60, 71);
    act(() => tracker.onEnded());
    expect(queue.flushes).toEqual(["ep1:6,7"]);

    play(0);
    unmount();
    expect(queue.flushes).toEqual(["ep1:6,7", "ep1:0"]);
  });

  it("flushes as soon as the set reaches the per-flush cap", async () => {
    mount();
    const seconds = Array.from({ length: WATCH_SEGMENT_FLUSH_MAX_BUCKETS }, (_, i) => i * 10);
    play(...seconds.slice(0, -1));
    expect(queue.flushes).toEqual([]);
    play(seconds[seconds.length - 1]);
    expect(queue.flushes).toHaveLength(1);
    expect(queue.flushes[0].split(":")[1].split(",")).toHaveLength(WATCH_SEGMENT_FLUSH_MAX_BUCKETS);
  });

  it("tracks nothing while disabled", async () => {
    mount(false);
    play(0, 10, 20);
    act(() => onAppState?.("background"));
    await after(SEGMENT_FLUSH_INTERVAL_MS);
    unmount();
    expect(queue.flushes).toEqual([]);
  });
});

describe("useSegmentTracker — what counts as a view of a bucket", () => {
  it("marks a bucket once while playback is continuous; a seek re-arms it", async () => {
    mount();
    play(12, 14, 19);
    act(() => onAppState?.("background"));
    expect(queue.flushes).toEqual(["ep1:1"]);

    // Still bucket 1, same continuous pass: not marked again.
    play(19.5);
    act(() => onAppState?.("background"));
    expect(queue.flushes).toEqual(["ep1:1"]);

    // A seek back into the bucket the playhead is already in: counts again.
    act(() => tracker.onSeek());
    play(15);
    act(() => onAppState?.("background"));
    expect(queue.flushes).toEqual(["ep1:1", "ep1:1"]);
  });
});
