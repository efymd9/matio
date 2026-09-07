import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The claim itself talks to Clerk and Stripe; nothing here does, and neither
// SDK should be loaded for a lookup that only reads one table.
vi.mock("@clerk/nextjs/server", () => ({ clerkClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

// The database is faked at the query-builder boundary; what is under test is
// WHICH table and WHICH predicate the lookup hands the driver, and how the
// answer maps to a boolean — the tombstone is a yes/no question about one
// Stripe customer id, and the callers (the webhook mirror, /welcome) decide
// on that answer whether an erased account gets re-created.
const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  queries: [] as { table: string; where: unknown; limit: number }[],
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Table = Parameters<typeof getTableName>[0];
  return {
    db: {
      select: () => ({
        from: (table: Table) => ({
          where: (where: unknown) => ({
            limit: async (limit: number) => {
              h.queries.push({ table: getTableName(table), where, limit });
              return h.rows;
            },
          }),
        }),
      }),
    },
  };
});

import { isErasedCustomer } from "./guest-checkout";

beforeEach(() => {
  h.rows = [];
  h.queries.length = 0;
});

describe("isErasedCustomer (art. 17 tombstone lookup)", () => {
  it("answers true when the customer id has a tombstone", async () => {
    h.rows = [{ erasedAt: new Date("2026-09-07T00:00:00Z") }];

    await expect(isErasedCustomer("cus_erased")).resolves.toBe(true);
  });

  it("answers false when there is none", async () => {
    await expect(isErasedCustomer("cus_alive")).resolves.toBe(false);
  });

  it("asks erased_customers by stripe_customer_id, one row", async () => {
    await isErasedCustomer("cus_x");

    expect(h.queries).toHaveLength(1);
    const [q] = h.queries;
    expect(q.table).toBe("erased_customers");
    expect(q.limit).toBe(1);
    const rendered = new PgDialect().sqlToQuery(q.where as SQL);
    expect(rendered.sql).toBe('"erased_customers"."stripe_customer_id" = $1');
    expect(rendered.params).toEqual(["cus_x"]);
  });
});
