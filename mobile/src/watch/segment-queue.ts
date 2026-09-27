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

type Flush = {
  episodeId: string;
  buckets: number[];
  attempts: number;
  // When this flush first failed (Date.now()); null until it has.
  firstFailedAt: number | null;
};

// ≈ 30 minutes of uncoalescable 20s flushes. Beyond that the oldest are
// dropped — measurement degrades, memory does not grow.
const MAX_QUEUED_FLUSHES = 90;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;
// When a flush that keeps failing is given up on: only once BOTH hold — it
// has been failing for longer than GIVE_UP_AFTER_MS, and it has been tried
// at least MAX_ATTEMPTS times since the app last came to the foreground.
//
// Time is the measure because the outage is (#300): a tunnel or a metro
// ride lasts minutes, and a count alone translated into wildly different
// windows — five attempts were ~75s on the backoff alone, and less when
// something kept restarting it. The attempt floor is what still bounds a
// broken backend: the counter upsert is not idempotent across retries (each
// landed attempt is +1 on views), so an endless retry against a server that
// accepts the upsert and then fails is not "eventually consistent" — it is a
// curve inflated by one view per attempt. Left to the backoff (5, 10, 20,
// 40, then every 60s) a flush gets ~9 attempts before it is dropped; each
// return to the foreground restarts the backoff and buys MAX_ATTEMPTS more.
const GIVE_UP_AFTER_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

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
      drainUnlessBackingOff();
      return;
    }
  }

  // At the cap the oldest flush goes — but never the one on the wire: it is
  // shifted off by position when its answer comes back, so evicting it would
  // make that shift take the NEXT flush, unsent, and a retryable failure
  // would lose the evicted one's buckets outright.
  if (queue.length >= MAX_QUEUED_FLUSHES) queue.splice(queue[0] === inFlight ? 1 : 0, 1);
  queue.push({ episodeId, buckets: [...new Set(buckets)], attempts: 0, firstFailedAt: null });
  drainUnlessBackingOff();
}

// The tracker enqueues every 20s. While a retry is scheduled, a new flush
// waits for it with everything else: draining at once would override the
// backoff — the old behaviour, which spent the attempts at 20s intervals
// and gave a flush up after roughly a minute of no network.
function drainUnlessBackingOff() {
  if (!retryTimer) void drain();
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
    head.attempts += 1;
    try {
      await api.saveWatchSegments({ episodeId: head.episodeId, buckets: head.buckets });
      queue.shift();
      retryDelay = RETRY_BASE_MS;
    } catch (err) {
      head.firstFailedAt ??= Date.now();
      if (isRefusal(err) || givenUp(head)) {
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

function givenUp(flush: Flush): boolean {
  return (
    flush.attempts >= MAX_ATTEMPTS &&
    flush.firstFailedAt !== null &&
    Date.now() - flush.firstFailedAt > GIVE_UP_AFTER_MS
  );
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
// the moment a backgrounded flush that never got out should be retried. It
// starts the head over: the backoff from its base, and a fresh set of
// attempts — tries spent in a dead zone say nothing about the network now.
// The failing-since clock is kept, so this is MAX_ATTEMPTS more tries, not a
// new window.
AppState.addEventListener("change", (next) => {
  if (next === "active" && queue.length > 0) {
    retryDelay = RETRY_BASE_MS;
    queue[0].attempts = 0;
    void drain();
  }
});
