import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The database is faked at the query-builder boundary: each write is recorded
// in the order it was issued, the insert's answers are scripted per call, and
// the predicates handed to the driver are rendered to SQL and asserted. Clerk
// and the erasure are spies — what is under test is WHICH row the resolver
// asks Clerk about, and what it does with each answer (#380). The erasure's
// own steps are pinned by lib/erase-user.test.ts and the webhook's suite.
const h = vi.hoisted(() => ({
  ops: [] as string[],
  /** One entry per users insert, in order; undefined = the insert goes through. */
  insertResults: [] as (Error | undefined)[],
  inserts: [] as { values: unknown; target: unknown }[],
  holder: undefined as { id: string } | undefined,
  selects: [] as unknown[],
  updates: [] as { set: unknown; where: unknown }[],
  updateFails: undefined as Error | undefined,
  getUser: vi.fn(),
  eraseUser: vi.fn(),
  sentry: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoNothing: async (opts: { target: unknown }) => {
          h.ops.push("insert users");
          const fails = h.insertResults.shift();
          if (fails) throw fails;
          h.inserts.push({ values, target: opts.target });
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (where: unknown) => ({
          limit: async () => {
            h.ops.push("select holder");
            h.selects.push(where);
            return h.holder ? [h.holder] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (set: unknown) => ({
        where: async (where: unknown) => {
          h.ops.push("update users");
          if (h.updateFails) throw h.updateFails;
          h.updates.push({ set, where });
        },
      }),
    }),
  },
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {
      getUser: async (id: string) => {
        h.ops.push(`clerk getUser ${id}`);
        return h.getUser(id);
      },
    },
  }),
}));

vi.mock("@/lib/erase-user", () => ({
  eraseUser: async (...args: unknown[]) => {
    h.ops.push(`erase ${String(args[0])}`);
    return h.eraseUser(...args);
  },
}));

const stripeGetter = vi.hoisted(() => () => ({}));
vi.mock("@/lib/stripe", () => ({ getStripe: stripeGetter }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentry }));

import { users } from "@/db/schema";
import { clerkPrimaryEmail, mirrorClerkUser } from "./user-mirror";

const USER_ID = "user_new";
const STALE_ID = "user_stale";
const EMAIL = "someone@example.invalid";
const CURRENT = "moved@example.invalid";
/** When Clerk created the NEW account. */
const CREATED = new Date("2026-10-01T05:56:00Z");

/** What postgres-js throws, wrapped the way Drizzle 0.44+ wraps it. */
function uniqueViolation(constraint: string) {
  return Object.assign(new Error("Failed query: insert into \"users\" …"), {
    cause: Object.assign(
      new Error(`duplicate key value violates unique constraint "${constraint}"`),
      { code: "23505", constraint_name: constraint },
    ),
  });
}
const emailTaken = () => uniqueViolation("users_email_unique");

function clerkError(status: number | undefined) {
  return Object.assign(new Error("Clerk refused"), {
    name: "ClerkAPIResponseError",
    ...(status === undefined ? {} : { status }),
  });
}

function account(primary: string | null, others: string[] = []) {
  return {
    primaryEmailAddress: primary ? { emailAddress: primary } : null,
    emailAddresses: [...(primary ? [primary] : []), ...others].map((emailAddress) => ({
      emailAddress,
    })),
  };
}

function render(where: unknown) {
  return new PgDialect().sqlToQuery(where as SQL);
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.ops.length = 0;
  h.insertResults.length = 0;
  h.inserts.length = 0;
  h.holder = undefined;
  h.selects.length = 0;
  h.updates.length = 0;
  h.updateFails = undefined;
  h.getUser.mockReset();
  h.eraseUser.mockReset().mockResolvedValue({ status: "erased" });
  h.sentry.mockReset();
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
  vi.stubEnv("POSTHOG_PROJECT_ID", "");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mirrorClerkUser · no conflict", () => {
  it("inserts the row ON CONFLICT (id) DO NOTHING and asks Clerk nothing", async () => {
    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "mirrored" });
    expect(h.ops).toEqual(["insert users"]);
    expect(h.inserts).toEqual([
      { values: { id: USER_ID, email: EMAIL }, target: users.id },
    ]);
    expect(h.sentry).not.toHaveBeenCalled();
  });

  it("a repeat after a successful run is the same plain insert — no lookup, no Clerk, no erasure", async () => {
    // The row is there after the first run, so ON CONFLICT (id) DO NOTHING
    // absorbs the second one: the address branch is never reached.
    await mirrorClerkUser(USER_ID, EMAIL, CREATED);
    await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(h.ops).toEqual(["insert users", "insert users"]);
    expect(h.eraseUser).not.toHaveBeenCalled();
  });

  it("a unique violation on another constraint is not this conflict — it propagates and Clerk is not asked", async () => {
    h.insertResults.push(uniqueViolation("users_stripe_customer_id_unique"));

    await expect(mirrorClerkUser(USER_ID, EMAIL, CREATED)).rejects.toThrow("Failed query");
    expect(h.ops).toEqual(["insert users"]);
  });
});

describe("mirrorClerkUser · the address is held by another row (#380)", () => {
  beforeEach(() => {
    h.insertResults.push(emailTaken());
    h.holder = { id: STALE_ID };
  });

  it("looks the holder up by the address and asks Clerk about THAT id", async () => {
    h.getUser.mockResolvedValue(account(CURRENT));

    await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    const lookup = render(h.selects[0]);
    expect(lookup.sql).toBe('"users"."email" = $1');
    expect(lookup.params).toEqual([EMAIL]);
    expect(h.getUser).toHaveBeenCalledWith(STALE_ID);
  });

  it("Clerk 404 → the stale row is erased by eraseUser with the webhook's deps as a LATE erasure (the address passed to the new account at its creation), then the row is inserted", async () => {
    h.getUser.mockRejectedValue(clerkError(404));

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "mirrored", resolved: "stale_row_erased" });
    expect(h.ops).toEqual([
      "insert users",
      "select holder",
      `clerk getUser ${STALE_ID}`,
      `erase ${STALE_ID}`,
      "insert users",
    ]);
    // The same deps the user.deleted webhook hands it.
    const [erasedId, deps, options] = h.eraseUser.mock.calls[0];
    expect(erasedId).toBe(STALE_ID);
    expect(deps).toMatchObject({ getStripe: stripeGetter, posthog: null });
    // Late: nothing searched or deleted by the address that the new account
    // may already own (lib/erase-user.ts:EraseUserOptions).
    expect(options).toEqual({ addressReassignedAt: CREATED });
    expect(h.inserts).toEqual([
      { values: { id: USER_ID, email: EMAIL }, target: users.id },
    ]);
    expect(h.updates).toEqual([]);
    // Reported by ids at warning level — it resolved itself.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      holderId: STALE_ID,
      outcome: "stale_row_erased",
      erase: "erased",
    });
    expect(error).not.toHaveBeenCalled();
    expect(h.sentry.mock.calls[0][1]).toEqual({
      level: "warning",
      tags: { userId: USER_ID, holderId: STALE_ID, outcome: "stale_row_erased" },
    });
  });

  it("an erasure that throws (the tombstone write) propagates — the row is not inserted", async () => {
    h.getUser.mockRejectedValue(clerkError(404));
    h.eraseUser.mockRejectedValue(new Error("connection reset"));

    await expect(mirrorClerkUser(USER_ID, EMAIL, CREATED)).rejects.toThrow("connection reset");
    expect(h.inserts).toEqual([]);
  });

  it("alive with another address → its row gets its current primary address, guarded by the old one, then the row is inserted", async () => {
    h.getUser.mockResolvedValue(account(CURRENT));

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "mirrored", resolved: "stale_address_corrected" });
    expect(h.ops).toEqual([
      "insert users",
      "select holder",
      `clerk getUser ${STALE_ID}`,
      "update users",
      "insert users",
    ]);
    expect(h.eraseUser).not.toHaveBeenCalled();
    expect(h.updates[0].set).toEqual({ email: CURRENT });
    const guard = render(h.updates[0].where);
    expect(guard.sql).toBe('("users"."id" = $1 and "users"."email" = $2)');
    expect(guard.params).toEqual([STALE_ID, EMAIL]);
    expect(h.inserts).toEqual([
      { values: { id: USER_ID, email: EMAIL }, target: users.id },
    ]);
    expect(warn.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      holderId: STALE_ID,
      outcome: "stale_address_corrected",
    });
    expect(h.sentry.mock.calls[0][1]).toMatchObject({ level: "warning" });
  });

  it("alive and still holding the address (case aside, secondary included) → nothing erased or written, unresolved", async () => {
    h.getUser.mockResolvedValue(account(CURRENT, ["SomeOne@Example.INVALID"]));

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "unresolved", reason: "address_still_owned" });
    expect(h.eraseUser).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(error.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      holderId: STALE_ID,
      outcome: "address_still_owned",
    });
    expect(h.sentry.mock.calls[0][1]).toEqual({
      level: "error",
      tags: { userId: USER_ID, holderId: STALE_ID, outcome: "address_still_owned" },
    });
  });

  it("alive with no address at all → nothing written, unresolved", async () => {
    h.getUser.mockResolvedValue(account(null));

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "unresolved", reason: "holder_has_no_address" });
    expect(h.updates).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(h.eraseUser).not.toHaveBeenCalled();
  });

  it("alive, but its current address is taken by a third row → nothing cascades, unresolved", async () => {
    h.getUser.mockResolvedValue(account(CURRENT));
    h.updateFails = emailTaken();

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "unresolved", reason: "current_address_taken" });
    expect(h.ops).toEqual([
      "insert users",
      "select holder",
      `clerk getUser ${STALE_ID}`,
      "update users",
    ]);
    expect(h.eraseUser).not.toHaveBeenCalled();
    expect(error.mock.calls[0][1]).toMatchObject({ outcome: "current_address_taken" });
  });

  it("an update failure that is not the address conflict propagates", async () => {
    h.getUser.mockResolvedValue(account(CURRENT));
    h.updateFails = new Error("connection reset");

    await expect(mirrorClerkUser(USER_ID, EMAIL, CREATED)).rejects.toThrow("connection reset");
    expect(h.inserts).toEqual([]);
  });

  it.each([
    ["a 5xx", 503],
    ["a refused key", 401],
    ["no HTTP status at all (a timeout)", undefined],
  ])("Clerk failing with %s → nothing erased or written, clerk_unavailable, reported by status", async (_label, status) => {
    h.getUser.mockRejectedValue(clerkError(status));

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "clerk_unavailable" });
    expect(h.eraseUser).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
    expect(h.inserts).toEqual([]);
    expect(error.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      holderId: STALE_ID,
      outcome: "clerk_unavailable",
      httpStatus: status,
      error: { name: "ClerkAPIResponseError", code: undefined, statusCode: undefined },
    });
    expect(h.sentry.mock.calls[0][1]).toMatchObject({ level: "error" });
  });

  it("the holder left between the insert and the lookup → the insert is simply repeated", async () => {
    h.holder = undefined;

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "mirrored" });
    expect(h.ops).toEqual(["insert users", "select holder", "insert users"]);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("the holder is this very account (the webhook and a sync at once) → done, Clerk not asked", async () => {
    h.holder = { id: USER_ID };

    const result = await mirrorClerkUser(USER_ID, EMAIL, CREATED);

    expect(result).toEqual({ status: "mirrored" });
    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.eraseUser).not.toHaveBeenCalled();
  });

  it("losing the address again on the repeat propagates — one attempt, no loop", async () => {
    h.getUser.mockRejectedValue(clerkError(404));
    h.insertResults.push(emailTaken());

    await expect(mirrorClerkUser(USER_ID, EMAIL, CREATED)).rejects.toThrow("Failed query");
    expect(h.ops.filter((op) => op === "insert users")).toHaveLength(2);
  });
});

describe("clerkPrimaryEmail", () => {
  it("prefers the primary address, falls back to the first, and is undefined without one", () => {
    expect(clerkPrimaryEmail(account(CURRENT, [EMAIL]))).toBe(CURRENT);
    expect(
      clerkPrimaryEmail({ primaryEmailAddress: null, emailAddresses: [{ emailAddress: EMAIL }] }),
    ).toBe(EMAIL);
    expect(clerkPrimaryEmail(account(null))).toBeUndefined();
    expect(clerkPrimaryEmail(null)).toBeUndefined();
  });
});
