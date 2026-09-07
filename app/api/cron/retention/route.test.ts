import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The run itself is tested in lib/retention.test.ts. Under test here is the
// DOOR: who may open it, and what the answer discloses.
const { runRetention } = vi.hoisted(() => ({ runRetention: vi.fn() }));
vi.mock("@/lib/retention", () => ({ runRetention }));

import { GET, isAuthorizedCronRequest } from "./route";

const SECRET = "dummy-cron-secret";

function request(authorization?: string) {
  return new Request("https://matio.tv/api/cron/retention", {
    headers: authorization ? { authorization } : {},
  });
}

const cleanRun = {
  deleted: { trial_sessions: 12, visitors: 3, watch_days: 0, show_reminders: 1 },
  failed: [],
  truncated: false,
  durationMs: 42,
};

beforeEach(() => {
  runRetention.mockReset().mockResolvedValue(cleanRun);
  vi.stubEnv("CRON_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAuthorizedCronRequest", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest("", SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCronRequest(`Basic ${btoa(`x:${SECRET}`)}`, SECRET)).toBe(false);
  });

  it("authorises nobody when no secret is configured — not even an empty bearer", () => {
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, undefined)).toBe(false);
  });
});

describe("GET /api/cron/retention", () => {
  it("is 401 without the platform's bearer, and deletes nothing", async () => {
    for (const header of [undefined, "Bearer wrong", `Basic ${btoa(`u:${SECRET}`)}`]) {
      const res = await GET(request(header));
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("is 401 for everyone when CRON_SECRET is unset — fail closed", async () => {
    // A deployment that forgot the variable must not become a public
    // "delete my ledgers" button, and must not silently run either.
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(request(`Bearer ${SECRET}`));

    expect(res.status).toBe(401);
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("runs the retention and answers with the counters", async () => {
    const res = await GET(request(`Bearer ${SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(runRetention).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ status: "ok", ...cleanRun });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("is 500 when a table failed, still reporting what was done", async () => {
    runRetention.mockResolvedValue({
      ...cleanRun,
      deleted: { ...cleanRun.deleted, visitors: 0 },
      failed: ["visitors"],
    });

    const res = await GET(request(`Bearer ${SECRET}`));
    const body = await res.json();

    // Red in the platform's cron log — a silent partial run is the failure
    // mode this endpoint exists to prevent.
    expect(res.status).toBe(500);
    expect(body.status).toBe("error");
    expect(body.failed).toEqual(["visitors"]);
    expect(body.deleted.trial_sessions).toBe(12);
  });

  it("answers with counters and table names only", async () => {
    const body = await (await GET(request(`Bearer ${SECRET}`))).json();

    expect(Object.keys(body).sort()).toEqual([
      "deleted",
      "durationMs",
      "failed",
      "status",
      "truncated",
    ]);
    expect(Object.values(body.deleted).every((n) => typeof n === "number")).toBe(true);
  });
});
