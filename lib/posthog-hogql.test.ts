import { afterEach, describe, expect, it, vi } from "vitest";

import { hogTs, runHogQL } from "./posthog-hogql";

// The HogQL transport shared by the admin pages and the subject-access
// export script. `fetch` is stubbed: what is under test is the request the
// transport builds and how it reads the answer — including the two error
// shapes the callers' catch blocks rely on.

const cfg = { key: "phx_dummy", projectId: "190233" };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runHogQL", () => {
  it("bounds the request with the caller's budget — the dashboard default, or the one passed in", async () => {
    const budget = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", async () => jsonResponse(200, { results: [] }));

    await runHogQL(cfg, "SELECT 1");
    expect(budget).toHaveBeenLastCalledWith(3500);

    await runHogQL(cfg, "SELECT 1", { timeoutMs: 30_000 });
    expect(budget).toHaveBeenLastCalledWith(30_000);
  });

  it("POSTs a HogQLQuery to the project's query endpoint with the personal key as Bearer", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { results: [["$pageview", 3]] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runHogQL(cfg, "SELECT 1")).resolves.toEqual([["$pageview", 3]]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https?:\/\/.+\/api\/projects\/190233\/query\/$/);
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: "Bearer phx_dummy",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      query: { kind: "HogQLQuery", query: "SELECT 1" },
    });
    // Bounded: a hung PostHog must not stall a render or a script.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers an empty list when the body carries no results", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(200, {}));

    await expect(runHogQL(cfg, "SELECT 1")).resolves.toEqual([]);
  });

  it("explains a 401/403 as a key-scope / project problem, naming the project id", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(403, { detail: "forbidden" }));

    await expect(runHogQL(cfg, "SELECT 1")).rejects.toThrow(
      /PostHog query API 403 .*query:read scope.*190233/,
    );
  });

  it("throws the bare status for any other failure", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse(500, { detail: "boom" }));

    await expect(runHogQL(cfg, "SELECT 1")).rejects.toThrow("PostHog query API 500");
  });
});

describe("hogTs", () => {
  it("formats a UTC instant as HogQL's 'YYYY-MM-DD HH:MM:SS'", () => {
    expect(hogTs(new Date("2026-09-07T12:34:56.789Z"))).toBe("2026-09-07 12:34:56");
  });
});
