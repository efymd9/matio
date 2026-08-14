import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route imports the real Drizzle client, which would open a socket. The
// point of these tests is the ANSWER the endpoint gives for each state of the
// database, so the database is the thing that gets faked.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute } }));

import { DB_PING_TIMEOUT_MS, GET } from "./route";

// A readiness probe is read by monitors and by whoever is holding the pager, so
// what is asserted here is the contract they rely on: the HTTP status, the
// reason code, and the absence of anything else.

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://matio:dummy-pass@db.example/matio");
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GET /api/readyz", () => {
  it("is 200 with a measured ping when the database answers", async () => {
    execute.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.database.durationMs).toBeGreaterThanOrEqual(0);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("is 503 with reason `unavailable` when the query fails", async () => {
    // Neon asleep, pooler refusing, credentials rotated — all one answer to
    // whoever is polling: not ready.
    execute.mockRejectedValue(new Error("connection refused"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.checks.database).toMatchObject({
      status: "error",
      reason: "unavailable",
    });
  });

  it("is 503 with reason `not_configured` and never touches the client without a URL", async () => {
    // `db/index.ts` is a lazy Proxy: it throws a bare Error on first query when
    // DATABASE_URL is missing, which would surface as an anonymous 500. Naming
    // that state is the difference between "the database is down" and "this
    // deployment was never given one" (Vercel previews live in the latter).
    vi.stubEnv("DATABASE_URL", "");

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.database.reason).toBe("not_configured");
    expect(execute).not.toHaveBeenCalled();
  });

  it("survives a client that throws before it ever returns a promise", async () => {
    // `db/index.ts` builds the postgres-js client on first property access, so
    // a malformed DATABASE_URL throws SYNCHRONOUSLY — past the promise the
    // timeout races, and straight out of the handler as a 500 if uncaught.
    execute.mockImplementation(() => {
      throw new Error("invalid connection string");
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.database.reason).toBe("unavailable");
  });

  it("gives up after the ping timeout instead of hanging with the database", async () => {
    vi.useFakeTimers();
    // A query that never settles is exactly what a wedged pool looks like.
    execute.mockReturnValue(new Promise(() => {}));

    const pending = GET();
    await vi.advanceTimersByTimeAsync(DB_PING_TIMEOUT_MS);
    const res = await pending;
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.checks.database.reason).toBe("timeout");
    expect(body.checks.database.durationMs).toBeGreaterThanOrEqual(
      DB_PING_TIMEOUT_MS,
    );
  });

  it("answers with status and duration only", async () => {
    execute.mockResolvedValue([{ "?column?": 1 }]);

    const body = await (await GET()).json();

    // No version, no host, no connection details: this endpoint is public on
    // matio.tv, and every extra field is free reconnaissance.
    expect(Object.keys(body).sort()).toEqual(["checks", "status"]);
    expect(Object.keys(body.checks.database).sort()).toEqual([
      "durationMs",
      "status",
    ]);
  });

  it("is never cached", async () => {
    execute.mockResolvedValue([{ "?column?": 1 }]);

    // A cached readiness answer describes the past — the one thing it must not
    // do while someone is deciding whether to roll back.
    expect((await GET()).headers.get("cache-control")).toBe("no-store");
  });
});
