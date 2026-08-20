import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "./route";

// /v1/config is the app's startup call: every launch hits it before anything
// else. What is asserted here is what a shipped binary cannot change about
// itself — the kill-switch states and whether this build may still run.

afterEach(() => {
  vi.unstubAllEnvs();
});

async function config() {
  return (await GET()).json();
}

describe("GET /api/v1/config", () => {
  it("never touches the database and always answers 200", async () => {
    // No db mock is registered in this file on purpose: if the route ever
    // grew a query, importing it would fail here rather than in production.
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("mirrors the payments kill-switch", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    expect((await config()).flags.paymentsEnabled).toBe(true);

    vi.stubEnv("PAYMENTS_ENABLED", "");
    expect((await config()).flags.paymentsEnabled).toBe(false);
  });

  it("reports the signup gate the token route enforces", async () => {
    // These two read the SAME resolver; drift between them is the free-pivot
    // bug class (client happily playing what the server refuses).
    vi.stubEnv("PAYMENTS_ENABLED", "");
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    expect((await config()).signupGate).toEqual({
      mode: "after_episodes",
      episodes: 1,
    });

    vi.stubEnv("REQUIRE_SIGNUP", "");
    expect((await config()).signupGate).toEqual({ mode: "none" });
  });

  it("keeps unbuilt features off unless explicitly switched on", async () => {
    // Downloads need Mux static renditions (paid plan); shipping the UI first
    // would put a dead button in a released binary.
    vi.stubEnv("APP_DOWNLOADS_ENABLED", "");
    vi.stubEnv("APP_CAST_ENABLED", "");
    const flags = (await config()).flags;
    expect(flags.downloadsEnabled).toBe(false);
    expect(flags.castEnabled).toBe(false);

    vi.stubEnv("APP_DOWNLOADS_ENABLED", "1");
    expect((await config()).flags.downloadsEnabled).toBe(true);
  });

  it("carries the build floor that retires a broken client", async () => {
    // The one lever that stops an old binary without a store round-trip.
    vi.stubEnv("APP_MIN_SUPPORTED_BUILD", "12");
    vi.stubEnv("APP_LATEST_BUILD", "15");
    const body = await config();
    expect(body.minSupportedBuild).toBe(12);
    expect(body.latestBuild).toBe(15);
  });

  it("hands the app absolute legal + support URLs and both locales", async () => {
    const body = await config();
    expect(body.locales).toEqual(["en", "es"]);
    for (const url of [body.urls.web, body.urls.terms, body.urls.privacy]) {
      expect(url).toMatch(/^https:\/\//);
    }
    expect(body.urls.terms).toMatch(/\/terms$/);
    expect(body.urls.support).toBe("mailto:contact@matio.tv");
  });
});
