import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The hourly checkout brake — one fixed-window counter in
// guest_checkout_attempts, keyed by whatever hash the caller hands it: the
// guest flow's HMAC of the client IP (30/hour, since 2026-06-13) and, since
// #227, `user:` + HMAC of the account for the signed-in builders (10/hour).
// The db is an in-memory twin of the ONE statement the limiter runs — an
// upsert on (key, window) that returns the new count — plus the prune delete,
// so the fixed-window arithmetic, the fail-open and the sampling are real.
const h = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  upserts: [] as Array<{ ipHash: string; windowStart: Date; count: number }>,
  deletes: 0,
  dbDown: false,
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (row: { ipHash: string; windowStart: Date; count: number }) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            if (h.dbDown) {
              // What postgres-js says when the pooler is unreachable — with
              // the connection string, password included, in the message.
              throw Object.assign(
                new Error(
                  "connect ECONNREFUSED postgres://matio:dummy-db-password@db.example.invalid/matio",
                ),
                { name: "PostgresError", code: "ECONNREFUSED" },
              );
            }
            h.upserts.push(row);
            const key = `${row.ipHash}|${row.windowStart.toISOString()}`;
            const next = (h.counts.get(key) ?? 0) + 1;
            h.counts.set(key, next);
            return [{ count: next }];
          },
        }),
      }),
    }),
    delete: () => ({
      where: async () => {
        h.deletes += 1;
      },
    }),
  },
}));

import {
  AUTH_CHECKOUT_RATELIMIT_PER_HOUR,
  GUEST_CHECKOUT_RATELIMIT_PER_HOUR,
  checkoutRateLimited,
  guestCheckoutRateLimited,
} from "./checkout-rate-limit";

const KEY = "user:" + "ab".repeat(32);

beforeEach(() => {
  h.counts = new Map();
  h.upserts = [];
  h.deletes = 0;
  h.dbDown = false;
  // The prune fires on a 5% sample; pinned OFF unless a case turns it on.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T10:30:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("checkoutRateLimited", () => {
  it("allows `limit` calls inside the hour and refuses the next one", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await checkoutRateLimited(KEY, 3)).toBe(false);
    }

    expect(await checkoutRateLimited(KEY, 3)).toBe(true);
  });

  it("counts every call — the refused ones too, so a flood stays braked", async () => {
    for (let i = 0; i < 6; i++) await checkoutRateLimited(KEY, 3);

    // Six upserts, the counter at six: a refusal is not a free retry.
    expect(h.upserts).toHaveLength(6);
    expect(h.counts.get(`${KEY}|2026-09-15T10:00:00.000Z`)).toBe(6);
    expect(await checkoutRateLimited(KEY, 3)).toBe(true);
  });

  it("buckets by the clock hour — the window starts on the hour, and the next hour starts fresh", async () => {
    vi.setSystemTime(new Date("2026-09-15T10:59:59.000Z"));
    await checkoutRateLimited(KEY, 1);
    expect(await checkoutRateLimited(KEY, 1)).toBe(true);

    vi.setSystemTime(new Date("2026-09-15T11:00:00.000Z"));

    expect(await checkoutRateLimited(KEY, 1)).toBe(false);
    expect(h.upserts.map((u) => u.windowStart.toISOString())).toEqual([
      "2026-09-15T10:00:00.000Z",
      "2026-09-15T10:00:00.000Z",
      "2026-09-15T11:00:00.000Z",
    ]);
  });

  it("keeps keys apart — an exhausted key says nothing about another", async () => {
    await checkoutRateLimited(KEY, 1);
    expect(await checkoutRateLimited(KEY, 1)).toBe(true);

    expect(await checkoutRateLimited("user:" + "cd".repeat(32), 1)).toBe(false);
  });

  it("cannot confuse a guest's bare IP hash with an account's prefixed key", async () => {
    // Both flows share the table; the `user:` prefix is what keeps an account
    // and a guest that happen to hash alike in separate rows.
    const hash = "ef".repeat(32);
    await checkoutRateLimited(hash, 1);
    expect(await checkoutRateLimited(hash, 1)).toBe(true);

    expect(await checkoutRateLimited(`user:${hash}`, 1)).toBe(false);
  });

  it("fails OPEN on a database error — and logs the failure by class, never by what the driver quoted", async () => {
    h.dbDown = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await checkoutRateLimited(KEY, 1)).toBe(false);
    expect(await checkoutRateLimited(KEY, 1)).toBe(false);

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("checkoutRateLimited: DB error — failing open");
    expect(logged).toContain("PostgresError");
    expect(logged).toContain("ECONNREFUSED");
    // The driver's message carries the connection string; the log must not.
    expect(logged).not.toContain("dummy-db-password");
    expect(logged).not.toContain("db.example.invalid");
  });

  it("prunes stale windows on a 5% sample of calls — and awaits it", async () => {
    vi.mocked(Math.random).mockReturnValueOnce(0.04);
    await checkoutRateLimited(KEY, 5);
    expect(h.deletes).toBe(1);

    vi.mocked(Math.random).mockReturnValueOnce(0.05);
    await checkoutRateLimited(KEY, 5);
    expect(h.deletes).toBe(1);
  });
});

describe("guestCheckoutRateLimited — the guest brake, unchanged", () => {
  it("is the generic counter at 30/hour on the bare IP hash", async () => {
    const ipHash = "12".repeat(32);
    for (let i = 0; i < 30; i++) {
      expect(await guestCheckoutRateLimited(ipHash)).toBe(false);
    }

    expect(await guestCheckoutRateLimited(ipHash)).toBe(true);
    // The key reaches the table verbatim — no prefix, exactly as before #227.
    expect(new Set(h.upserts.map((u) => u.ipHash))).toEqual(new Set([ipHash]));
  });
});

describe("the two budgets", () => {
  it("default to 10/hour per account and 30/hour per guest IP", () => {
    expect(AUTH_CHECKOUT_RATELIMIT_PER_HOUR).toBe(10);
    expect(GUEST_CHECKOUT_RATELIMIT_PER_HOUR).toBe(30);
  });

  it("are env levers — read once, at module load", async () => {
    vi.stubEnv("AUTH_CHECKOUT_RATELIMIT_PER_HOUR", "3");
    vi.stubEnv("GUEST_CHECKOUT_RATELIMIT_PER_HOUR", "7");
    vi.resetModules();

    const fresh = await import("./checkout-rate-limit");

    expect(fresh.AUTH_CHECKOUT_RATELIMIT_PER_HOUR).toBe(3);
    expect(fresh.GUEST_CHECKOUT_RATELIMIT_PER_HOUR).toBe(7);
    vi.unstubAllEnvs();
  });
});
