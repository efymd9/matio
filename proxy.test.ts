// Tests for the staging lock as it is actually wired into proxy.ts — the file
// that runs on every request. The pure decision logic is covered in
// lib/staging-lock.test.ts; what is proved here is the wiring: an anonymous
// visitor is stopped BEFORE the marketing machinery runs, the password gets
// in, /api/healthz stays reachable for uptime checks, and with the variable
// unset nothing about the request changes at all.
//
// Clerk is stubbed: its middleware needs a publishable key and a live
// instance, neither of which belongs in a unit test — and the lock must work
// regardless of what Clerk decides about a request.

import { NextRequest, NextResponse } from "next/server";
import type { NextFetchEvent } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` is a build-time marker: outside Next's react-server condition
// its default entry throws on import, and proxy.ts pulls it in through
// lib/free-mode. Neutralised, not worked around — the guard has nothing to
// say inside a node test runner.
vi.mock("server-only", () => ({}));

vi.mock("@clerk/nextjs/server", () => ({
  // Mirrors the real contract: hand the handler an `auth()` and turn a
  // "nothing to add" answer into a pass-through response.
  clerkMiddleware:
    (
      handler: (
        auth: () => Promise<{ userId: string | null }>,
        req: NextRequest,
        event: NextFetchEvent,
      ) => Promise<NextResponse | undefined>,
    ) =>
    async (req: NextRequest, event: NextFetchEvent) =>
      (await handler(async () => ({ userId: null }), req, event)) ??
      NextResponse.next(),
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) =>
    patterns.some((pattern) =>
      new RegExp(`^${pattern.replace("(.*)", "(?:/.*)?")}$`).test(
        req.nextUrl.pathname,
      ),
    ),
}));

const { default: proxy } = await import("./proxy");

// Obviously fake — the nightly gitleaks scan should have nothing to chase.
const PASSWORD = "dummy-staging-password";
const event = {} as NextFetchEvent;

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://matio-staging.example${path}`, { headers });
}

const authHeader = (user: string, pass: string) => ({
  authorization: `Basic ${btoa(`${user}:${pass}`)}`,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — staging lock off (production and local dev)", () => {
  it("does not touch the response when the variable is unset", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/"), event);

    expect(res?.status).not.toBe(401);
    // No robots header: production must never be told not to index itself.
    expect(res?.headers.get("X-Robots-Tag")).toBeNull();
    expect(res?.headers.get("WWW-Authenticate")).toBeNull();
  });

  it("treats an empty value as no lock — a blank Vercel variable is absent", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", "");

    const res = await proxy(request("/"), event);

    expect(res?.status).not.toBe(401);
    expect(res?.headers.get("X-Robots-Tag")).toBeNull();
  });
});

describe("proxy — staging lock on", () => {
  it("challenges an anonymous visitor with a browser-answerable 401", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/"), event);

    expect(res?.status).toBe(401);
    expect(res?.headers.get("WWW-Authenticate")).toBe('Basic realm="matio staging"');
    expect(res?.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    // The lock runs before the cookie machinery: a drive-by hit must not leave
    // a visitor id or a consent record behind on the bench.
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("challenges a wrong password", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/", authHeader("owner", "wrong")), event);

    expect(res?.status).toBe(401);
  });

  it("lets the password through and marks the answer noindex", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/", authHeader("owner", PASSWORD)), event);

    expect(res?.status).not.toBe(401);
    expect(res?.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    // ...and the bench behaves like the product for whoever is let in: the
    // lock wraps proxy.ts, it does not replace it (matio_aid is minted by the
    // audience-measurement layer at the bottom of the file).
    expect(res?.headers.get("Set-Cookie")).toContain("matio_aid");
  });

  it("keeps /api/healthz open — the uptime check has no password", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/api/healthz"), event);

    expect(res?.status).not.toBe(401);
    // Open, but still not something a crawler should list.
    expect(res?.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("locks the visit beacon — no drive-by rows in the bench's ledger", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/api/t"), event);

    expect(res?.status).toBe(401);
  });
});
