import { AppState } from "react-native";
import { api, ApiError } from "@/api/client";
import { WATCH_SEGMENT_FLUSH_MAX_BUCKETS } from "@/shared/api-types";

// The offline queue in front of POST /api/v1/watch-segments.
//
// The web player can fire-and-forget a flush: a browser tab that loses the
// network loses ≤20s of buckets and nobody minds. A phone loses the network
// in every tunnel, so here a flush that fails for a NETWORK reason (or a 5xx)
// stays queued and is retried — with backoff, and at once when the app
// returns to the foreground, which is the closest thing to a "reconnected"
// signal available without a NetInfo dependency. A flush the server REFUSES
// (any 4xx: past the gate, no session, malformed) is dropped: a retry would
// get the same answer.
//
// Process-lifetime only. The one persistence layer the app has is the
// keychain (SecureStore, ~2KB per value), which is the wrong place for
// behavioural data and too small for a queue; persisting across an app kill
// needs a real store, which is a new dependency — see docs/registry.md.
//
// Consecutive flushes for the same episode coalesce while the merged set
// stays under the per-flush cap, so a long outage produces one request per
// episode rather than one per 20s, and a retry after a lost response
// double-counts as little as possible.

type Flush = { episodeId: string; buckets: number[] };

// ≈ 30 minutes of uncoalescable 20s flushes. Beyond that the oldest are
// dropped — measurement degrades, memory does not grow.
const MAX_QUEUED_FLUSHES = 90;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

const queue: Flush[] = [];
let inFlight: Flush | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = RETRY_BASE_MS;

export function enqueueWatchSegments(episodeId: string, buckets: number[]) {
  if (buckets.length === 0) return;

  const tail = queue[queue.length - 1];
  // Never merge into the request that is on the wire: its buckets are
  // about to be shifted off as sent.
  if (tail && tail !== inFlight && tail.episodeId === episodeId) {
    const merged = new Set(tail.buckets);
    for (const b of buckets) merged.add(b);
    if (merged.size <= WATCH_SEGMENT_FLUSH_MAX_BUCKETS) {
      tail.buckets = [...merged];
      void drain();
      return;
    }
  }

  if (queue.length >= MAX_QUEUED_FLUSHES) queue.shift();
  queue.push({ episodeId, buckets: [...new Set(buckets)] });
  void drain();
}

// A refusal is final; anything else (timeout, unreachable, 5xx, unreadable)
// is worth another try later.
function isRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code === "network") return false;
  return err.status >= 400 && err.status < 500;
}

async function drain(): Promise<void> {
  if (inFlight) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  while (queue.length > 0) {
    const head = queue[0];
    inFlight = head;
    try {
      await api.saveWatchSegments({ episodeId: head.episodeId, buckets: head.buckets });
      queue.shift();
      retryDelay = RETRY_BASE_MS;
    } catch (err) {
      if (isRefusal(err)) {
        queue.shift();
        continue;
      }
      scheduleRetry();
      return;
    } finally {
      inFlight = null;
    }
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void drain();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
}

// Foreground = the best available "network may be back" signal, and also
// the moment a backgrounded flush that never got out should be retried.
AppState.addEventListener("change", (next) => {
  if (next === "active" && queue.length > 0) {
    retryDelay = RETRY_BASE_MS;
    void drain();
  }
});
