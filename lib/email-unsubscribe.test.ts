import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// unsubscribeEmail against a small in-memory ledger: every statement the
// module issues is rendered through the real Postgres dialect, and the fake
// applies it only when it is the exact by-address shape it expects — so a
// changed predicate fails here instead of silently touching other rows.
const h = vi.hoisted(() => ({
  reminders: [] as { id: string; email: string }[],
  ideas: [] as { id: string; email: string; marketingOptIn: boolean }[],
  statements: [] as { op: string; table: string; sql: string; params: unknown[] }[],
}));

vi.mock("@/db", async () => {
  const { getTableName: tableName } = await import("drizzle-orm");
  const { PgDialect: Dialect } = await import("drizzle-orm/pg-core");
  const render = (where: SQL) => new Dialect().sqlToQuery(where);
  return {
    db: {
      delete: (table: PgTable) => ({
        where: (where: SQL) => ({
          returning: async () => {
            const name = tableName(table);
            const q = render(where);
            h.statements.push({ op: "delete", table: name, ...q });
            if (name !== "show_reminders" || q.sql !== '"show_reminders"."email" = $1') {
              throw new Error(`unexpected delete: ${name} ${q.sql}`);
            }
            const gone = h.reminders.filter((r) => r.email === q.params[0]);
            h.reminders = h.reminders.filter((r) => r.email !== q.params[0]);
            return gone.map((r) => ({ id: r.id }));
          },
        }),
      }),
      update: (table: PgTable) => ({
        set: (values: { marketingOptIn?: boolean }) => ({
          where: async (where: SQL) => {
            const name = tableName(table);
            const q = render(where);
            h.statements.push({ op: "update", table: name, ...q });
            if (name !== "idea_submissions" || q.sql !== '"idea_submissions"."email" = $1') {
              throw new Error(`unexpected update: ${name} ${q.sql}`);
            }
            expect(values).toEqual({ marketingOptIn: false });
            for (const row of h.ideas) {
              if (row.email === q.params[0]) row.marketingOptIn = false;
            }
          },
        }),
      }),
    },
  };
});

import { unsubscribeEmail } from "./email-unsubscribe";

beforeEach(() => {
  h.statements.length = 0;
  h.reminders = [
    { id: "rem_1", email: "fan@example.invalid" },
    { id: "rem_2", email: "fan@example.invalid" },
    { id: "rem_3", email: "other@example.invalid" },
  ];
  h.ideas = [
    { id: "idea_1", email: "fan@example.invalid", marketingOptIn: true },
    { id: "idea_2", email: "fan@example.invalid", marketingOptIn: false },
    { id: "idea_3", email: "other@example.invalid", marketingOptIn: true },
  ];
});

describe("unsubscribeEmail", () => {
  it("withdraws the marketing_opt_in of the address's story ideas (#297) and keeps the ideas themselves", async () => {
    await unsubscribeEmail("fan@example.invalid");

    // Every idea row is still there — unsubscribing is not withdrawing a pitch.
    expect(h.ideas.map((r) => r.id)).toEqual(["idea_1", "idea_2", "idea_3"]);
    expect(h.ideas).toEqual([
      { id: "idea_1", email: "fan@example.invalid", marketingOptIn: false },
      { id: "idea_2", email: "fan@example.invalid", marketingOptIn: false },
      // Another address keeps its consent.
      { id: "idea_3", email: "other@example.invalid", marketingOptIn: true },
    ]);
    // Never a DELETE on the idea table.
    expect(
      h.statements.filter((s) => s.table === "idea_submissions").map((s) => s.op),
    ).toEqual(["update"]);
  });

  it("matches both tables by the lowercased address — both store it lowercased", async () => {
    await unsubscribeEmail("Fan@Example.INVALID");

    expect(h.statements.map((s) => [s.op, s.table, s.params])).toEqual([
      ["delete", "show_reminders", ["fan@example.invalid"]],
      ["update", "idea_submissions", ["fan@example.invalid"]],
    ]);
    expect(h.ideas.find((r) => r.id === "idea_1")?.marketingOptIn).toBe(false);
  });

  it("still deletes every reminder row for the address and answers with their count — unchanged by the ideas step", async () => {
    const removed = await unsubscribeEmail("fan@example.invalid");

    expect(removed).toBe(2);
    expect(h.reminders).toEqual([{ id: "rem_3", email: "other@example.invalid" }]);
  });

  it("an address with no ideas and no reminders is a no-op that answers 0", async () => {
    const removed = await unsubscribeEmail("nobody@example.invalid");

    expect(removed).toBe(0);
    expect(h.ideas.filter((r) => r.marketingOptIn).map((r) => r.id)).toEqual([
      "idea_1",
      "idea_3",
    ]);
  });
});
