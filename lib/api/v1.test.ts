import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  absoluteMediaUrl,
  apiError,
  apiOk,
  DEVICE_ID_HEADER,
  envInt,
  readDeviceId,
  resolveSignupGate,
} from "./v1";

// The server half of the /api/v1 mobile surface. Everything asserted here is a
// contract a SHIPPED BINARY depends on: a phone that already left the store
// cannot be patched when one of these answers changes shape.

afterEach(() => {
  vi.unstubAllEnvs();
});

function reqWithDevice(value: string | null) {
  const headers = new Headers();
  if (value !== null) headers.set(DEVICE_ID_HEADER, value);
  // The helper only ever touches `.headers`, so a bare object is a faithful
  // stand-in for NextRequest here.
  return { headers } as unknown as Parameters<typeof readDeviceId>[0];
}

describe("readDeviceId", () => {
  it("accepts a canonical UUID and normalizes case", () => {
    const id = "3F2504E0-4F89-41D3-9A0C-0305E82C3301";
    expect(readDeviceId(reqWithDevice(id))).toBe(id.toLowerCase());
  });

  it("returns null for anything that is not a UUID", () => {
    // This value becomes a key in the visit ledger, so garbage must degrade to
    // "anonymous, untracked" rather than reaching the database.
    for (const bad of ["", "not-a-uuid", "'; drop table users;--", "12345"]) {
      expect(readDeviceId(reqWithDevice(bad))).toBeNull();
    }
    expect(readDeviceId(reqWithDevice(null))).toBeNull();
  });
});

describe("absoluteMediaUrl", () => {
  it("leaves absolute URLs untouched", () => {
    const blob = "https://x.public.blob.vercel-storage.com/shows/poster.png";
    expect(absoluteMediaUrl(blob)).toBe(blob);
  });

  it("absolutizes legacy same-origin paths", () => {
    // A native client has no origin to resolve against — a relative URL would
    // reach the app as an unloadable image.
    const url = absoluteMediaUrl("/shows/cartero-poster.png");
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toMatch(/\/shows\/cartero-poster\.png$/);
  });

  it("passes null through", () => {
    expect(absoluteMediaUrl(null)).toBeNull();
  });
});

describe("envInt", () => {
  it("reads a positive integer", () => {
    vi.stubEnv("APP_TEST_INT", "42");
    expect(envInt("APP_TEST_INT", 1)).toBe(42);
  });

  it("falls back when unset or malformed, instead of throwing", () => {
    // These feed /v1/config, the app's startup call: a fat-fingered env var
    // must never 500 every launch.
    expect(envInt("APP_TEST_UNSET_INT", 7)).toBe(7);
    for (const bad of ["", "abc", "-3"]) {
      vi.stubEnv("APP_TEST_INT", bad);
      expect(envInt("APP_TEST_INT", 7)).toBe(7);
    }
  });
});

describe("resolveSignupGate", () => {
  it("hands gating to the tier system in paid mode", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    // No second flag matrix: with payments on, per-episode tiers decide, and
    // REQUIRE_SIGNUP is deliberately inert.
    expect(resolveSignupGate()).toEqual({ mode: "tiers" });
  });

  it("opens the first episode of each show when the signup gate is live", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    // Deliberately SOFTER than the web, which hard-gates all playback: a login
    // wall on first launch is the likeliest App Store 5.1.1(v) rejection.
    expect(resolveSignupGate()).toEqual({ mode: "after_episodes", episodes: 1 });
  });

  it("honours APP_SIGNUP_GATE_EPISODES so the depth moves without a store release", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");
    vi.stubEnv("REQUIRE_SIGNUP", "1");
    vi.stubEnv("APP_SIGNUP_GATE_EPISODES", "3");
    expect(resolveSignupGate()).toEqual({ mode: "after_episodes", episodes: 3 });
  });

  it("gates nothing in plain free mode", () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");
    vi.stubEnv("REQUIRE_SIGNUP", "");
    expect(resolveSignupGate()).toEqual({ mode: "none" });
  });
});

describe("apiOk / apiError", () => {
  it("defaults to no-store so identity-shaped answers are never cached", async () => {
    const res = apiOk({ hello: "world" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(res.json()).resolves.toEqual({ hello: "world" });
  });

  it("lets a public read override the cache header", () => {
    const res = apiOk({}, { headers: { "Cache-Control": "public, s-maxage=60" } });
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=60");
  });

  it("maps each error code to its HTTP status", async () => {
    const cases = [
      ["bad_request", 400],
      ["unauthorized", 401],
      ["forbidden", 403],
      ["not_found", 404],
      ["rate_limited", 429],
      ["upgrade_required", 426],
      ["server_error", 500],
    ] as const;
    for (const [code, status] of cases) {
      expect(apiError(code, "nope").status).toBe(status);
    }
  });

  it("carries the machine-readable reason the app branches on", async () => {
    const res = apiError("forbidden", "Sign up to keep watching.", {
      reason: "signup_required",
    });
    const body = await res.json();
    expect(body.error).toEqual({
      code: "forbidden",
      message: "Sign up to keep watching.",
      reason: "signup_required",
    });
  });

  it("omits `reason` entirely when there isn't one", async () => {
    const body = await apiError("not_found", "Episode not found.").json();
    expect(body.error).not.toHaveProperty("reason");
  });
});
