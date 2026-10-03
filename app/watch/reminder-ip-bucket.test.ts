import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The reminder capture's anti-flood brake (#351): at most 10 NEW rows per
// (hashed IP bucket, rolling hour). An IPv6 client holds a whole prefix and
// can rotate its source address inside it, so the bucket is the /64 — keyed
// per address, every rotation would open a fresh 10 and the ledger the admin
// send blasts through Resend would fill with garbage. The REAL getClientIp /
// hashClientIp here, against an in-memory show_reminders: the brake's answer
// is what is under test, not a mock's.
const h = vi.hoisted(() => ({
  clientIp: "203.0.113.7",
  rows: [] as { ipHash: string; email: string }[],
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "x-vercel-forwarded-for": h.clientIp }),
}));
vi.mock("@/db/schema", () => ({
  episodes: {},
  seasons: {},
  showReminders: {},
  shows: {},
  trialSessions: {},
}));
// eq() keeps its right-hand side so the fake count can read the ip hash the
// action filtered by; and() keeps its parts.
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => parts,
  eq: (_col: unknown, val: unknown) => ({ val }),
  gt: () => undefined,
  isNull: () => undefined,
  sql: () => ({ mapWith: () => "count" }),
}));
vi.mock("@/db", () => ({
  db: {
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: [{ val: string }]) => {
          // The show lookup ends in .limit(1); the brake's count is awaited.
          const answer = "n" in fields
            ? [{ n: h.rows.filter((r) => r.ipHash === cond[0].val).length }]
            : [{ id: "show-1" }];
          return {
            limit: async () => answer,
            then: (resolve: (v: unknown) => unknown) => resolve(answer),
          };
        },
      }),
    }),
    insert: () => ({
      values: (row: { ipHash: string; email: string }) => ({
        onConflictDoUpdate: async () => {
          h.rows.push(row);
        },
      }),
    }),
  },
}));
vi.mock("@/lib/visitor", () => ({ stampVisitorWallSeen: vi.fn() }));
vi.mock("@/lib/attribution", () => ({ EMPTY_ATTRIBUTION: {} }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/episode-access", () => ({
  resolveEffectiveTier: vi.fn(),
  getOrderedReadyEpisodeIds: vi.fn(),
  showHasTierGating: vi.fn(),
}));
vi.mock("@/lib/watch-progress", () => ({
  clampPositionSeconds: vi.fn(),
  saveWatchProgressForUser: vi.fn(),
}));
vi.mock("@/lib/watch-segments-write", () => ({ saveWatchSegmentsFor: vi.fn() }));

import { subscribeToShowReminder } from "./actions";

let n = 0;
async function capture(clientIp: string) {
  h.clientIp = clientIp;
  n += 1;
  return subscribeToShowReminder({ showId: "show-1", email: `fan${n}@example.com` });
}

beforeEach(() => {
  h.rows = [];
  n = 0;
});

describe("subscribeToShowReminder — the per-IP brake counts an IPv6 client per /64", () => {
  it("rotating the source address inside one /64 never opens a fresh bucket", async () => {
    for (let i = 1; i <= 10; i++) {
      expect(await capture(`2001:db8:abcd:12::${i}`)).toEqual({ ok: true });
    }

    // Another address of the SAME prefix — still the same, full bucket.
    expect(await capture("2001:db8:abcd:12:ffff:ffff:ffff:fffe")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(h.rows).toHaveLength(10);

    // The neighbouring /64 is a different network: its own bucket.
    expect(await capture("2001:db8:abcd:13::1")).toEqual({ ok: true });
  });

  it("stores one 64-hex HMAC per bucket on the row — that is what the brake counts by", async () => {
    await capture("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd");
    await capture("2001:db8:abcd:12::1");

    expect(h.rows).toHaveLength(2);
    expect(h.rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.rows[1].ipHash).toBe(h.rows[0].ipHash);
  });

  it("IPv4 stays per address, and an IPv4-mapped client is the same client", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await capture(i % 2 ? "::ffff:203.0.113.7" : "203.0.113.7")).toEqual({
        ok: true,
      });
    }
    expect(await capture("203.0.113.7")).toEqual({ ok: false, reason: "rate_limited" });
    // A neighbour address of the same IPv4 /24 is not merged.
    expect(await capture("203.0.113.8")).toEqual({ ok: true });
  });
});
