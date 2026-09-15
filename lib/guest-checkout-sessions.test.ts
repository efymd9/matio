import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { drizzle } from "drizzle-orm/pg-proxy";
import * as schema from "@/db/schema";
import {
  claimSoleGuestSession,
  hashClaimToken,
  PRUNE_SHARE,
  type GuestSessionDb,
} from "./guest-checkout-sessions";

// The guest sweep's bookkeeping (#224). What is under test is the STATEMENT:
// the atomicity argument in the module — two parallel claims for one cookie
// can never both come back `null` — rests on one `INSERT … ON CONFLICT DO
// UPDATE … RETURNING old.session_id`, so the SQL the real dialect renders is
// pinned here, through a pg-proxy driver that records what would run and
// answers with whatever a test seeds. (The statement itself was run against a
// local Postgres 18 with two sessions holding the row lock — see PR #224.)

type Call = { sql: string; params: unknown[]; method: string };

function recorderDb(answer: (call: Call) => unknown[][]) {
  const calls: Call[] = [];
  const db = drizzle(
    async (sql, params, method) => {
      const call = { sql, params, method };
      calls.push(call);
      return { rows: answer(call) };
    },
    { schema },
  );
  return { db: db as unknown as GuestSessionDb, calls };
}

const HASH = "a".repeat(64);

beforeEach(() => {
  vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", "dummy-signing-key");
  // No prune unless a case asks for one.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hashClaimToken", () => {
  it("is a keyed 64-hex digest that never contains the token", () => {
    const token = "5b1c9e0a-2d4f-4c8e-9a7b-3f6d1e2c4b5a";
    const hash = hashClaimToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashClaimToken(token)).toBe(hash);
    expect(hashClaimToken("another-token")).not.toBe(hash);
  });

  it("changes with the signing key — the salt is the key, not a constant", () => {
    const before = hashClaimToken("token");
    vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", "dummy-signing-key-rotated");

    expect(hashClaimToken("token")).not.toBe(before);
  });
});

describe("claimSoleGuestSession — the one statement", () => {
  it("upserts the new id under the hash and returns the OLD id from the same statement", async () => {
    const { db, calls } = recorderDb(() => [["cs_prev"]]);

    const previous = await claimSoleGuestSession(db, HASH, "cs_new");

    expect(previous).toBe("cs_prev");
    expect(calls).toHaveLength(1);
    // The lock-and-read semantics live in this text: ON CONFLICT DO UPDATE
    // waits on the conflicting row's lock and updates its LATEST version;
    // `old.session_id` (Postgres 18) is that version's value before the
    // update — and NULL on the plain-insert path. A `(SELECT …)` subquery
    // here would read the statement's start snapshot instead and answer
    // NULL to both of two parallel claims.
    expect(calls[0].sql).toBe(
      'insert into "guest_checkout_sessions" ("claim_token_hash", "session_id", "created_at") values ($1, $2, default) on conflict ("claim_token_hash") do update set "session_id" = $3, "created_at" = now() returning old.session_id',
    );
    expect(calls[0].params).toEqual([HASH, "cs_new", "cs_new"]);
  });

  it("answers null on the insert path — this buying party had no session to expire", async () => {
    const { db } = recorderDb(() => [[null]]);

    expect(await claimSoleGuestSession(db, HASH, "cs_new")).toBeNull();
  });

  it("answers null when the driver returns no row at all", async () => {
    const { db } = recorderDb(() => []);

    expect(await claimSoleGuestSession(db, HASH, "cs_new")).toBeNull();
  });

  it("lets a failed upsert propagate — the caller fails closed on it", async () => {
    const { db } = recorderDb(() => {
      throw new Error("connection refused");
    });

    // Drizzle wraps the driver's error (DrizzleQueryError); the original
    // rides on `.cause` — the shape lib/db-errors.ts walks.
    await expect(claimSoleGuestSession(db, HASH, "cs_new")).rejects.toMatchObject({
      cause: { message: "connection refused" },
    });
  });
});

describe("claimSoleGuestSession — self-pruning", () => {
  it("prunes rows whose last claim is older than 24h on a share of the calls, after the claim", async () => {
    vi.spyOn(Math, "random").mockReturnValue(PRUNE_SHARE / 2);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    const { db, calls } = recorderDb((call) =>
      call.sql.startsWith("insert") ? [["cs_prev"]] : [],
    );

    const previous = await claimSoleGuestSession(db, HASH, "cs_new");
    vi.useRealTimers();

    expect(previous).toBe("cs_prev");
    expect(calls.map((c) => c.sql)).toEqual([
      expect.stringMatching(/^insert into "guest_checkout_sessions"/),
      'delete from "guest_checkout_sessions" where "guest_checkout_sessions"."created_at" < $1',
    ]);
    // The proxy driver serialises the Date; the cut-off is exactly now − 24h.
    expect(calls[1].params).toEqual(["2026-09-14T12:00:00.000Z"]);
  });

  it("skips the prune on the other calls", async () => {
    vi.spyOn(Math, "random").mockReturnValue(PRUNE_SHARE);
    const { db, calls } = recorderDb(() => [["cs_prev"]]);

    await claimSoleGuestSession(db, HASH, "cs_new");

    expect(calls).toHaveLength(1);
  });

  it("a failed prune is logged by class only and never costs the claim its answer", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = recorderDb((call) => {
      if (call.sql.startsWith("delete")) {
        throw Object.assign(new Error("deadlock detected while running the quoted statement"), {
          name: "PostgresError",
          code: "40P01",
        });
      }
      return [["cs_prev"]];
    });

    expect(await claimSoleGuestSession(db, HASH, "cs_new")).toBe("cs_prev");

    expect(warn).toHaveBeenCalledTimes(1);
    const [line, payload] = warn.mock.calls[0];
    expect(line).toBe("claimSoleGuestSession: pruning stale rows failed");
    // Drizzle wraps the driver's error (DrizzleQueryError, the statement in
    // its message); what is logged is the class the wrapper shows and
    // nothing of the message — not the statement, not the driver's text.
    expect(payload).toEqual({
      error: { name: expect.any(String), code: undefined, statusCode: undefined },
    });
    expect(JSON.stringify(payload)).not.toContain("quoted statement");
    expect(JSON.stringify(payload)).not.toContain("guest_checkout_sessions");
  });
});
