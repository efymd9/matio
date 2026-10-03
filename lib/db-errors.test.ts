import { describe, expect, it } from "vitest";
import { describeDbError, isForeignKeyViolation, isUniqueViolation } from "./db-errors";

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
