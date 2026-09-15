import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  erasePosthogPerson,
  lookupPosthogPersons,
  POSTHOG_ERASE_TIMEOUT_MS,
} from "./posthog-erase";
import { POSTHOG_API_HOST } from "./posthog-hogql";

// The processor half of the account erasure. Under test: WHICH requests go
// to PostHog (the lookup by distinct_id, then one DELETE per person with
// delete_events=true, all bearing the key and a timeout), and that every
// way PostHog can disappoint — no person, no scope, an outage, a timeout,
// no credentials — comes back as a typed status, never as a throw.

const CFG = { key: "phx_dummy", projectId: "190233" };
const DISTINCT_ID = "user_2abc";
const BASE = `${POSTHOG_API_HOST}/api/projects/190233/persons/`;

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function calls() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? "GET",
    auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
    signal: init?.signal,
  }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("erasePosthogPerson · the happy path", () => {
  it("looks the person up by distinct_id, then deletes every person found WITH its events", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          results: [
            { id: 42, uuid: "0192-…", properties: { email: "x@example.invalid" } },
            { id: "43" },
          ],
          next: null,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "deleted", personIds: ["42", "43"] });
    expect(calls().map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET ${BASE}?distinct_id=${DISTINCT_ID}`,
      `DELETE ${BASE}42/?delete_events=true`,
      `DELETE ${BASE}43/?delete_events=true`,
    ]);
    for (const call of calls()) {
      expect(call.auth).toBe("Bearer phx_dummy");
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("encodes the distinct id and the project id into the path, so neither can add a query or a segment", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { results: [] }));

    await erasePosthogPerson(
      { key: "phx_dummy", projectId: "1/../2" },
      "user_a b&c=d/../e",
    );

    expect(calls()[0].url).toBe(
      `${POSTHOG_API_HOST}/api/projects/1%2F..%2F2/persons/?distinct_id=user_a%20b%26c%3Dd%2F..%2Fe`,
    );
  });

  it("no person behind the id → not_found, and no DELETE is sent", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { results: [] }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "not_found", personIds: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a person gone between the lookup and the delete (404) still counts as deleted", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { results: [{ id: 42 }] }))
      .mockResolvedValueOnce(json(404, { detail: "Not found." }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "deleted", personIds: ["42"] });
  });

  it("ignores result entries without a usable id rather than sending a DELETE to nowhere", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, { results: [{ uuid: "no-id" }, null, { id: 7 }] }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "deleted", personIds: ["7"] });
    expect(calls()).toHaveLength(2);
  });
});

describe("erasePosthogPerson · the key cannot do it (401 / 403 → skipped_forbidden, never a throw)", () => {
  it.each([401, 403])("%i on the lookup", async (status) => {
    fetchMock.mockResolvedValueOnce(json(status, { type: "authentication_error" }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({
      status: "skipped_forbidden",
      personIds: [],
      httpStatus: status,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("%i on the delete — the key reads persons but lacks person:write", async (status) => {
    fetchMock
      .mockResolvedValueOnce(json(200, { results: [{ id: 42 }, { id: 43 }] }))
      .mockResolvedValueOnce(json(status, { type: "authentication_error" }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({
      status: "skipped_forbidden",
      personIds: ["42", "43"],
      httpStatus: status,
    });
    // Stops at the first refusal: the second person is not attempted.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("erasePosthogPerson · PostHog is down or slow (→ failed, never a throw)", () => {
  it("a timeout on the lookup", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      }),
    );

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({
      status: "failed",
      personIds: [],
      error: { name: "TimeoutError", code: undefined, statusCode: undefined },
    });
  });

  it("a network failure on the delete keeps the ids it had found", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { results: [{ id: 42 }] }))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({
      status: "failed",
      personIds: ["42"],
      error: { name: "TypeError", code: undefined, statusCode: undefined },
    });
  });

  it("a 5xx on the lookup", async () => {
    fetchMock.mockResolvedValueOnce(new Response("upstream error", { status: 502 }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "failed", personIds: [], httpStatus: 502 });
  });

  it("a 4xx on the delete reports the status and never reads the body", async () => {
    const refusal = json(400, { detail: "would quote the request" });
    fetchMock
      .mockResolvedValueOnce(json(200, { results: [{ id: 42 }] }))
      .mockResolvedValueOnce(refusal);

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "failed", personIds: ["42"], httpStatus: 400 });
    expect(refusal.bodyUsed).toBe(false);
  });

  it("a 200 that is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));

    const result = await erasePosthogPerson(CFG, DISTINCT_ID);

    expect(result).toMatchObject({ status: "failed", personIds: [] });
    expect(result.error?.name).toBe("SyntaxError");
  });

  it("bounds every request by the erasure budget", () => {
    // The signal is created by AbortSignal.timeout — the constant is the
    // contract the caller's function budget is planned around.
    expect(POSTHOG_ERASE_TIMEOUT_MS).toBe(5_000);
  });
});

describe("erasePosthogPerson · not configured", () => {
  it("skips with skipped_unconfigured and makes no request at all", async () => {
    const result = await erasePosthogPerson(null, DISTINCT_ID);

    expect(result).toEqual({ status: "skipped_unconfigured", personIds: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lookupPosthogPersons (the dry run's read)", () => {
  it("reports the persons found without deleting anything", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { results: [{ id: 42 }] }));

    const result = await lookupPosthogPersons(CFG, DISTINCT_ID);

    expect(result).toEqual({ status: "found", personIds: ["42"] });
    expect(calls().map((c) => c.method)).toEqual(["GET"]);
  });

  it("shares the skip and failure statuses with the erasure", async () => {
    fetchMock.mockResolvedValueOnce(json(403, {}));
    expect(await lookupPosthogPersons(CFG, DISTINCT_ID)).toEqual({
      status: "skipped_forbidden",
      personIds: [],
      httpStatus: 403,
    });

    expect(await lookupPosthogPersons(null, DISTINCT_ID)).toEqual({
      status: "skipped_unconfigured",
      personIds: [],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
