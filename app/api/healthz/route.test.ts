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
    vi.stubEnv("APP_ENV", undefined);
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
    vi.stubEnv("APP_ENV", "");
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

  // `environment` is read first during an incident, and until APP_ENV existed
  // it could not tell the stages apart: Vercel labels the production branch of
  // EVERY project `production`, and staging is a separate project whose
  // production branch is `main`.
  describe("environment", () => {
    it("answers with the explicit APP_ENV marker over the Vercel target", async () => {
      vi.stubEnv("APP_ENV", "staging");
      vi.stubEnv("VERCEL_ENV", "production");

      const body = await GET().json();

      // The whole point: on the staging project both variables are present
      // and the marker must win, or staging keeps calling itself production.
      expect(body.environment).toBe("staging");
    });

    it("falls back to the Vercel target when no marker is set", async () => {
      vi.stubEnv("APP_ENV", undefined);
      vi.stubEnv("VERCEL_ENV", "preview");

      const body = await GET().json();

      // Production carries no marker of its own, so the previous behaviour has
      // to survive untouched — one env var forgotten must not blank the field.
      expect(body.environment).toBe("preview");
    });

    it("treats an empty marker as no marker", async () => {
      // A Vercel variable can be defined blank, and a blank one that shadowed
      // VERCEL_ENV would answer `"environment": ""` — the same lie `present()`
      // exists to prevent for `version`.
      vi.stubEnv("APP_ENV", "");
      vi.stubEnv("VERCEL_ENV", "production");

      const body = await GET().json();

      expect(body.environment).toBe("production");
    });
  });
});
