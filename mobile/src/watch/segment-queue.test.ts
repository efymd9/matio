import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WATCH_SEGMENT_FLUSH_MAX_BUCKETS,
  type SaveWatchSegmentsRequest,
} from "@/shared/api-types";

// #300 — the offline queue in front of POST /v1/watch-segments. A phone
// loses the network in every tunnel, and what the queue decides then is
// retention-curve data kept or lost:
//   - a refusal (4xx) is final; a network error — including a Clerk that did
//     not answer in time, which the client reports as `network` since #299 —
//     or a 5xx is retried at 5s, then 10s, 20s…;
//   - a flush is given up only after five minutes of failing, never after a
//     handful of attempts (it used to go after five, ~75s on the backoff and
//     sooner, because every 20s tracker flush restarted the retry);
//   - a flush enqueued during the backoff waits for it;
//   - the foreground sends at once and starts the head over;
//   - the 90-flush cap evicts the oldest flush NOT on the wire.
//
// The request itself is a promise each case answers when it chooses; the
// queue module is loaded fresh per case (its state is module-level), and the
// errors are the client's real ApiError.

type Call = {
  body: SaveWatchSegmentsRequest;
  resolve: () => void;
  reject: (err: unknown) => void;
};
const server = vi.hoisted(() => ({ calls: [] as Call[] }));

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    api: {
      saveWatchSegments: (body: SaveWatchSegmentsRequest) =>
        new Promise((resolve, reject) => {
          server.calls.push({
            body,
            resolve: () => resolve({ ok: true, accepted: body.buckets.length }),
            reject,
          });
        }),
    },
  };
});
vi.mock("@/api/device", () => ({ getDeviceId: async () => null }));

let enqueue: typeof import("./segment-queue").enqueueWatchSegments;
let ApiError: typeof import("@/api/client").ApiError;
let onAppState: ((next: string) => void) | null = null;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("__DEV__", false);
  server.calls = [];
  onAppState = null;
  vi.resetModules();
  const { AppState } = await import("react-native");
  vi.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    onAppState = handler as (next: string) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  ({ enqueueWatchSegments: enqueue } = await import("./segment-queue"));
  ({ ApiError } = await import("@/api/client"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const refused = () => new ApiError("bad_request", "Invalid body.", 400);
const offline = () => new ApiError("network", "Couldn't reach Matio.", 0);
// What client.ts throws for an `auth: "required"` write when Clerk gives no
// answer within its 3s pre-flight deadline — before any fetch (#299).
const clerkSilent = () => new ApiError("network", "Couldn't confirm who is signed in.", 0);
const unavailable = () => new ApiError("server_error", "Request failed (503).", 503);

// Every request the queue made, in order: "episode:bucket,bucket".
const sent = () => server.calls.map((c) => `${c.body.episodeId}:${c.body.buckets.join(",")}`);

// Advancing the fake clock also lets the drain loop react to an answer (its
// await, catch and finally are microtasks).
const after = (ms: number) => vi.advanceTimersByTimeAsync(ms);

async function fail(err: unknown) {
  server.calls[server.calls.length - 1].reject(err);
  await after(0);
}

async function succeed() {
  server.calls[server.calls.length - 1].resolve();
  await after(0);
}

// Answers every request as it comes until the queue has nothing left.
async function succeedUntilEmpty() {
  let answered = 0;
  while (server.calls.length > answered) {
    answered = server.calls.length;
    await succeed();
  }
}

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

describe("segment queue — what is final and what is retried", () => {
  it("drops a refusal (400) without a retry, and does not hold the next flush behind it", async () => {
    enqueue("ep1", [0, 1]);
    expect(sent()).toEqual(["ep1:0,1"]);

    await fail(refused());
    await after(10 * 60_000);
    expect(sent()).toEqual(["ep1:0,1"]);

    enqueue("ep2", [3]);
    expect(sent()).toEqual(["ep1:0,1", "ep2:3"]);
  });

  it("retries a network error, a Clerk that never answered and a 503 — at 5s, then 10s, then 20s", async () => {
    enqueue("ep1", [0]);
    await fail(offline());

    await after(4_999);
    expect(server.calls).toHaveLength(1);
    await after(1);
    expect(server.calls).toHaveLength(2);
    await fail(clerkSilent());

    await after(9_999);
    expect(server.calls).toHaveLength(2);
    await after(1);
    expect(server.calls).toHaveLength(3);
    await fail(unavailable());

    await after(19_999);
    expect(server.calls).toHaveLength(3);
    await after(1);
    expect(server.calls).toHaveLength(4);
    await succeed();

    // Landed: the same buckets every time, and nothing more afterwards.
    expect(sent()).toEqual(["ep1:0", "ep1:0", "ep1:0", "ep1:0"]);
    await after(10 * 60_000);
    expect(server.calls).toHaveLength(4);
  });

  it("holds a flush enqueued during the backoff until the retry — the tracker's 20s flush no longer restarts it", async () => {
    enqueue("ep1", [0]);
    await fail(offline()); // the retry is due at 5s

    await after(1_000);
    enqueue("ep1", [1]); // the same episode: joins the waiting flush
    await after(1_000);
    enqueue("ep2", [5]); // another episode: queued behind it
    expect(server.calls).toHaveLength(1);

    await after(2_999);
    expect(server.calls).toHaveLength(1);
    await after(1);
    expect(sent()).toEqual(["ep1:0", "ep1:0,1"]);

    await succeed();
    expect(sent()).toEqual(["ep1:0", "ep1:0,1", "ep2:5"]);
  });

  it("keeps a failing flush for five minutes of outage, not for five attempts", async () => {
    enqueue("ep1", [0]);
    await fail(offline()); // t = 0

    // The backoff alone: attempts at 5, 15, 35, 75, 135, 195 and 255s — the
    // fifth and later ones inside the window are still retried.
    const waits = [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000];
    for (const [i, wait] of waits.entries()) {
      await after(wait);
      expect(server.calls).toHaveLength(i + 2);
      await fail(offline());
    }

    // 315s: past the window, with well over five attempts — this failure is
    // the last one.
    await after(60_000);
    expect(server.calls).toHaveLength(9);
    await fail(offline());

    await after(10 * 60_000);
    expect(server.calls).toHaveLength(9);

    // Given up means gone: the next flush goes out at once, alone.
    enqueue("ep1", [1]);
    expect(sent().at(-1)).toBe("ep1:1");
  });
});

describe("segment queue — coalescing", () => {
  it("merges new buckets into the queued tail of the same episode, never into the flush on the wire", async () => {
    enqueue("ep1", [0, 1]); // on the wire
    enqueue("ep1", [1, 2]); // must not join the request in flight
    enqueue("ep1", [2, 3]); // joins the queued tail
    enqueue("ep2", [7]); // another episode: a flush of its own
    enqueue("ep2", [7, 8]); // joins it
    expect(sent()).toEqual(["ep1:0,1"]);

    await succeedUntilEmpty();
    expect(sent()).toEqual(["ep1:0,1", "ep1:1,2,3", "ep2:7,8"]);
  });

  it("never merges past the per-flush cap", async () => {
    enqueue("ep1", [0]); // on the wire
    enqueue("ep1", range(1, 100));
    enqueue("ep1", range(101, WATCH_SEGMENT_FLUSH_MAX_BUCKETS - 100)); // exactly at the cap
    enqueue("ep1", [WATCH_SEGMENT_FLUSH_MAX_BUCKETS + 1]); // one over: a new flush

    await succeedUntilEmpty();
    expect(server.calls.map((c) => c.body.buckets.length)).toEqual([
      1,
      WATCH_SEGMENT_FLUSH_MAX_BUCKETS,
      1,
    ]);
    expect(server.calls[2].body.buckets).toEqual([WATCH_SEGMENT_FLUSH_MAX_BUCKETS + 1]);
  });
});

describe("segment queue — the return to the foreground", () => {
  it("sends at once and restarts the backoff from 5s", async () => {
    enqueue("ep1", [0]);
    await fail(offline()); // t = 0, next at 5s
    await after(5_000);
    await fail(offline()); // next at 15s
    await after(10_000);
    await fail(offline()); // next at 35s
    await after(1_000);
    expect(server.calls).toHaveLength(3);

    onAppState?.("active");
    expect(server.calls).toHaveLength(4);
    await fail(offline());

    await after(4_999);
    expect(server.calls).toHaveLength(4);
    await after(1);
    expect(server.calls).toHaveLength(5);
  });

  it("gives the head a fresh set of attempts, even past the five-minute window", async () => {
    enqueue("ep1", [0]);
    await fail(offline()); // t = 0
    for (const wait of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]) {
      await after(wait);
      await fail(offline()); // …through t = 255s: eight attempts
    }
    expect(server.calls).toHaveLength(8);

    await after(35_000); // t = 290s, the retry still pending
    onAppState?.("active");
    expect(server.calls).toHaveLength(9);
    await fail(offline()); // t = 290s, attempt 1 of the fresh set
    await after(5_000);
    await fail(offline()); // 295s, attempt 2
    await after(10_000);
    await fail(offline()); // 305s: past the window, but only attempt 3

    await after(20_000);
    expect(server.calls).toHaveLength(12);
    await fail(offline()); // 325s, attempt 4
    await after(40_000);
    expect(server.calls).toHaveLength(13);
    await fail(offline()); // 365s, attempt 5: now it goes

    await after(10 * 60_000);
    expect(server.calls).toHaveLength(13);
  });

  it("sends nothing when the queue is empty", async () => {
    onAppState?.("active");
    await after(0);
    expect(server.calls).toHaveLength(0);
  });
});

describe("segment queue — the 90-flush cap", () => {
  it("evicts the oldest flush that is not on the wire; the one in flight survives its failure", async () => {
    enqueue("ep0", [0]); // on the wire, answer pending
    for (let i = 1; i < 90; i++) enqueue(`ep${i}`, [i]); // the queue is full
    enqueue("ep90", [90]); // one over: ep1 goes, not ep0
    expect(server.calls).toHaveLength(1);

    await fail(offline());
    await after(5_000);
    expect(sent()).toEqual(["ep0:0", "ep0:0"]);

    await succeedUntilEmpty();
    const episodes = sent().map((s) => s.split(":")[0]);
    expect(episodes).toEqual(["ep0", "ep0", ...range(2, 89).map((i) => `ep${i}`)]);
  });
});
