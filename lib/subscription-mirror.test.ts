import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The mirror's "no local user" branch is the one under test: for a guest
// (pay-first) subscription it is where an account gets CREATED from a Stripe
// customer — and, after art. 17 erasure, where it would get re-created. The
// database is faked at the query-builder boundary and dispatched by table
// name; the claim and the tombstone lookup are spies, so the assertions are
// about which of them the mirror calls, in which case, and what it writes
// afterwards.
const h = vi.hoisted(() => ({
  // Per-table queues of rows the next select on that table returns.
  rows: {} as Record<string, unknown[][]>,
  selects: [] as string[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  erased: vi.fn(),
  claim: vi.fn(),
  markConverted: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Table = Parameters<typeof getTableName>[0];
  return {
    db: {
      select: () => ({
        from: (table: Table) => ({
          where: () => ({
            limit: async () => {
              const name = getTableName(table);
              h.selects.push(name);
              return h.rows[name]?.shift() ?? [];
            },
          }),
        }),
      }),
      insert: (table: Table) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => {
            h.inserts.push({ table: getTableName(table), values });
          },
        }),
      }),
    },
  };
});

vi.mock("@/lib/guest-checkout", () => ({
  isGuestSubscription: (sub: Stripe.Subscription) =>
    (sub.metadata ?? {}).guest === "1",
  isErasedCustomer: (...a: unknown[]) => h.erased(...a),
  claimGuestCheckout: (...a: unknown[]) => h.claim(...a),
}));
vi.mock("@/lib/trial", () => ({
  markUserTrialsConverted: (...a: unknown[]) => h.markConverted(...a),
}));

import { mirrorSubscription } from "./subscription-mirror";

const PRICE = "price_dummy_monthly";

function subscription(over: Partial<Stripe.Subscription> = {}) {
  return {
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    trial_start: null,
    metadata: { guest: "1" },
    items: {
      data: [
        {
          current_period_end: 4_102_444_800, // 2100-01-01
          price: { id: PRICE, unit_amount: 3800, currency: "usd" },
        },
      ],
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  h.rows = {};
  h.selects.length = 0;
  h.inserts.length = 0;
  h.erased.mockReset().mockResolvedValue(false);
  h.claim.mockReset().mockResolvedValue({
    userId: "user_claimed",
    email: "buyer@example.invalid",
    created: true,
    guestBorn: true,
  });
  h.markConverted.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("STRIPE_PRICE_MONTHLY", PRICE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mirrorSubscription · no local user, guest subscription", () => {
  it("does NOT re-claim a customer whose account was erased — consumes the event", async () => {
    h.erased.mockResolvedValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(mirrorSubscription(subscription())).resolves.toBeUndefined();

    expect(h.erased).toHaveBeenCalledWith("cus_1");
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
    expect(h.markConverted).not.toHaveBeenCalled();
    // Says so by id only.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("erased account");
    expect(warn.mock.calls[0][1]).toEqual({ customerId: "cus_1", subId: "sub_1" });
  });

  it("reads the customer id off an expanded customer object too", async () => {
    h.erased.mockResolvedValue(true);

    await mirrorSubscription(
      subscription({
        customer: { id: "cus_expanded", object: "customer" } as never,
      }),
    );

    expect(h.erased).toHaveBeenCalledWith("cus_expanded");
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("claims and mirrors as before when there is no tombstone", async () => {
    // users: first lookup by customer → none; second by the claimed id → row.
    h.rows.users = [[], [{ id: "user_claimed", email: "buyer@example.invalid" }]];
    const sub = subscription();

    await mirrorSubscription(sub);

    expect(h.erased).toHaveBeenCalledWith("cus_1");
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledWith(sub);
    // The tombstone is asked BEFORE the claim, never after.
    expect(h.erased.mock.invocationCallOrder[0]).toBeLessThan(
      h.claim.mock.invocationCallOrder[0],
    );
    expect(h.inserts).toEqual([
      {
        table: "subscriptions",
        values: expect.objectContaining({
          userId: "user_claimed",
          stripeSubscriptionId: "sub_1",
          status: "active",
          plan: "monthly",
        }),
      },
    ]);
    expect(h.markConverted).toHaveBeenCalledWith("user_claimed");
  });

  it("lets a claim failure propagate so Stripe retries (unchanged contract)", async () => {
    h.claim.mockRejectedValue(new Error("clerk down"));

    await expect(mirrorSubscription(subscription())).rejects.toThrow("clerk down");
    expect(h.inserts).toEqual([]);
  });
});

describe("mirrorSubscription · the tombstone is asked only where a claim could happen", () => {
  it("non-guest subscription with no local user: warn and return, no tombstone lookup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await mirrorSubscription(subscription({ metadata: {} }));

    expect(h.erased).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
    expect(warn.mock.calls[0][0]).toContain("no local user");
  });

  it("existing local user: no tombstone lookup, no claim, mirrored as before", async () => {
    h.rows.users = [[{ id: "user_1", email: "member@example.invalid" }]];

    await mirrorSubscription(subscription());

    expect(h.erased).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.inserts.map((i) => i.values.userId)).toEqual(["user_1"]);
  });
});
