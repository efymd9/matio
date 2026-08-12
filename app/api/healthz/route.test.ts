import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

// What this endpoint is FOR is answering "what is actually live right now",
// so the tests assert the answers, not that the function runs. A health check
// that reports a stale or missing version is worse than none: it is used
// during releases and incidents, when nobody has spare attention to doubt it.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/healthz", () => {
  it("reports the build's version, short commit and environment", async () => {
    vi.stubEnv("APP_VERSION", "1.4.2");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef0123456789abcdef01234567");
    vi.stubEnv("VERCEL_ENV", "production");

    const body = await GET().json();

    expect(body).toEqual({
      status: "ok",
      version: "1.4.2",
      // Short SHA: enough to find the commit, short enough to read aloud
      // over a call during an incident.
      commit: "0123456",
      environment: "production",
    });
  });

  it("degrades honestly when the build carries no version metadata", async () => {
    vi.stubEnv("APP_VERSION", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_ENV", "");

    const body = await GET().json();

    // "unknown" rather than a silent omission or a plausible-looking
    // fallback: a wrong version is more dangerous than an admitted gap.
    expect(body.status).toBe("ok");
    expect(body.version).toBe("unknown");
    expect(body.commit).toBeNull();
    expect(body.environment).toBe("development");
  });

  it("is never cached", async () => {
    // A CDN-cached health check answers for the deployment that happened to
    // be live when the cache filled — the exact question it exists to answer.
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });
});
