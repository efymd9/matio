import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  describeDbError,
  isForeignKeyViolation,
  isUniqueViolation,
  withRedactedFailure,
} from "./db-errors";

// Drizzle 0.44+ throws a DrizzleQueryError whose own `.code` is undefined —
// the PostgresError with the SQLSTATE sits on `.cause`. Both helpers must see
// through that wrapper, or every caller's typed branch silently becomes the
// generic failure.
function pgError(code: string): Error {
  return Object.assign(new Error("driver error"), { code });
}

function drizzleWrapped(cause: unknown): Error {
  return Object.assign(new Error("Failed query: insert into …"), { cause });
}

describe("isForeignKeyViolation (23503)", () => {
  it("matches a bare driver error", () => {
    expect(isForeignKeyViolation(pgError("23503"))).toBe(true);
  });

  it("matches the driver error wrapped on `.cause` by Drizzle", () => {
    const wrapped = drizzleWrapped(pgError("23503"));
    expect((wrapped as { code?: string }).code).toBeUndefined();
    expect(isForeignKeyViolation(wrapped)).toBe(true);
  });

  it("does not match another SQLSTATE, a plain error, or nothing", () => {
    expect(isForeignKeyViolation(drizzleWrapped(pgError("23505")))).toBe(false);
    expect(isForeignKeyViolation(new Error("connection refused"))).toBe(false);
    expect(isForeignKeyViolation(null)).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });

  it("gives up on a cause chain deeper than five links instead of walking forever", () => {
    let err: unknown = pgError("23503");
    for (let i = 0; i < 5; i++) err = drizzleWrapped(err);
    expect(isForeignKeyViolation(err)).toBe(false);
  });
});

describe("isUniqueViolation (23505) — unchanged by the shared walk", () => {
  it("matches bare and wrapped, and not a foreign-key violation", () => {
    expect(isUniqueViolation(pgError("23505"))).toBe(true);
    expect(isUniqueViolation(drizzleWrapped(pgError("23505")))).toBe(true);
    expect(isUniqueViolation(drizzleWrapped(pgError("23503")))).toBe(false);
  });
});

describe("isUniqueViolation with a constraint name (#380)", () => {
  // postgres-js reports the violated constraint as `constraint_name`; the
  // users mirror must tell "the address is taken" from any other unique key.
  const onConstraint = (name: string) =>
    Object.assign(pgError("23505"), { constraint_name: name });

  it("matches only the named constraint, bare or wrapped", () => {
    expect(
      isUniqueViolation(onConstraint("users_email_unique"), "users_email_unique"),
    ).toBe(true);
    expect(
      isUniqueViolation(
        drizzleWrapped(onConstraint("users_email_unique")),
        "users_email_unique",
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        drizzleWrapped(onConstraint("users_stripe_customer_id_unique")),
        "users_email_unique",
      ),
    ).toBe(false);
  });

  it("does not match a violation that names no constraint, or another SQLSTATE", () => {
    expect(isUniqueViolation(pgError("23505"), "users_email_unique")).toBe(false);
    expect(
      isUniqueViolation(
        Object.assign(pgError("23503"), { constraint_name: "users_email_unique" }),
        "users_email_unique",
      ),
    ).toBe(false);
  });
});

describe("describeDbError — what a failure may be described by", () => {
  // Moved here from lib/retention.test.ts when the function moved (#326).
  it("reads the SQLSTATE through Drizzle's wrapper and reports the thrown error's class", () => {
    const wrapped = Object.assign(new Error("Failed query: select …\nparams: dummy"), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("deadlock detected"), {
        name: "PostgresError",
        code: "40P01",
      }),
    });

    expect(describeDbError(wrapped)).toEqual({
      name: "DrizzleQueryError",
      code: "40P01",
    });
  });

  it("reads a bare driver error too", () => {
    const bare = Object.assign(new Error("relation does not exist"), {
      name: "PostgresError",
      code: "42P01",
    });
    expect(describeDbError(bare)).toEqual({ name: "PostgresError", code: "42P01" });
  });

  it("answers with no code when there is none, and survives a non-Error throw", () => {
    expect(describeDbError(new TypeError("boom"))).toEqual({ name: "TypeError", code: null });
    expect(describeDbError("string thrown")).toEqual({ name: "string", code: null });
    expect(describeDbError(undefined)).toEqual({ name: "undefined", code: null });
  });

  it("never carries the message — the statement and its params stay out of the answer", () => {
    const wrapped = Object.assign(
      new Error("Failed query: select … where token = $1\nparams: 1eaf0000-dead-4bee-8f00-00000000beef"),
      { name: "DrizzleQueryError" },
    );

    expect(JSON.stringify(describeDbError(wrapped))).not.toContain("1eaf0000");
  });
});

describe("withRedactedFailure — a statement that binds an address (#350)", () => {
  const ADDRESS = "fan.marker@example.invalid";
  // The realistic shape: Drizzle's wrapper repeats the statement with its
  // params; the driver's error quotes the address in its own text and `detail`.
  const refusal = () =>
    Object.assign(
      new Error(
        `Failed query: delete from "show_reminders" where "show_reminders"."email" = $1 returning "id"\nparams: ${ADDRESS}`,
      ),
      {
        name: "DrizzleQueryError",
        cause: Object.assign(new Error(`terminating connection while deleting ${ADDRESS}`), {
          name: "PostgresError",
          code: "57P01",
          detail: `Key (email)=(${ADDRESS})`,
        }),
      },
    );

  it("hands back the statement's own result when it succeeds", async () => {
    await expect(withRedactedFailure("s", async () => [{ id: "rem_1" }])).resolves.toEqual([
      { id: "rem_1" },
    ]);
  });

  it("re-throws a failure as class + SQLSTATE under a fixed message — no text, no cause", async () => {
    const thrown = await withRedactedFailure("unsubscribe: delete show_reminders by address", () => {
      throw refusal();
    }).catch((e: unknown) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      name: "DrizzleQueryError",
      code: "57P01",
      message: "unsubscribe: delete show_reminders by address failed",
    });
    expect((thrown as Error).cause).toBeUndefined();
    // Everything Node would print for it — the stack, own props, the cause.
    expect(inspect(thrown, { depth: 5 })).not.toContain(ADDRESS);
    // What the callers read still reads the same.
    expect(describeDbError(thrown)).toEqual(describeDbError(refusal()));
  });

  it("keeps the violated constraint's name — the users mirror's #380 branch still reads `users_email_unique` — and still no address", async () => {
    // The users insert refused on the address: Drizzle's wrapper, then the
    // driver's 23505 naming the constraint and quoting the row in `detail`.
    const conflict = Object.assign(
      new Error(`Failed query: insert into "users" ("id", "email") values ($1, $2)\nparams: user_1,${ADDRESS}`),
      {
        name: "DrizzleQueryError",
        cause: Object.assign(new Error(`duplicate key value violates unique constraint "users_email_unique"`), {
          name: "PostgresError",
          code: "23505",
          constraint_name: "users_email_unique",
          detail: `Key (email)=(${ADDRESS}) already exists.`,
        }),
      },
    );

    const thrown = await withRedactedFailure("users mirror: insert", () => {
      throw conflict;
    }).catch((e: unknown) => e);

    expect(isUniqueViolation(thrown, "users_email_unique")).toBe(true);
    expect(isUniqueViolation(thrown, "users_pkey")).toBe(false);
    expect(thrown).toMatchObject({ code: "23505", constraint_name: "users_email_unique" });
    expect((thrown as Error).message).toBe("users mirror: insert failed");
    expect((thrown as Error).cause).toBeUndefined();
    // Message, stack and every own property, as Node would print them.
    expect(inspect(thrown, { depth: 5 })).not.toContain(ADDRESS);
    expect(JSON.stringify(thrown)).not.toContain(ADDRESS);
  });

  it("a rejected promise is redacted the same way, and an error with no SQLSTATE stays without one", async () => {
    const thrown = await withRedactedFailure("s", () =>
      Promise.reject(new TypeError(`cannot bind ${ADDRESS}`)),
    ).catch((e: unknown) => e);

    expect(thrown).toMatchObject({ name: "TypeError", message: "s failed" });
    expect("code" in (thrown as object)).toBe(false);
    expect("constraint_name" in (thrown as object)).toBe(false);
    expect(inspect(thrown)).not.toContain(ADDRESS);
  });
});
