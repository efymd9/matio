import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/db", () => ({ db: {} }));

import { getClientIp, hashClientIp } from "./trial";

// hashClientIp is THE function every per-IP limiter keys by (trial mint,
// reminder capture, guest checkout, the /ideas brake) — so the /64 bucketing
// of #351 lives inside it. The bucket rules themselves are lib/ip-bucket.test.ts;
// this pins that the hash is of the BUCKET and that nothing else moved.

const SALT = "sk-test-ip-hash-salt";

function hmac(input: string): string {
  return crypto.createHmac("sha256", SALT).update(input).digest("hex");
}

beforeEach(() => {
  vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", SALT);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hashClientIp", () => {
  it("two addresses of one IPv6 /64 hash to one bucket; the next /64 does not", () => {
    expect(hashClientIp("2001:db8::1")).toBe(hashClientIp("2001:db8::ffff"));
    expect(hashClientIp("2001:db8:0:1::1")).not.toBe(hashClientIp("2001:db8::1"));
  });

  it("hashes the bucket, not the address", () => {
    expect(hashClientIp("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd")).toBe(
      hmac("2001:db8:abcd:12::/64"),
    );
  });

  it("an IPv4 hash is what it always was — existing rows keep counting", () => {
    expect(hashClientIp("203.0.113.7")).toBe(hmac("203.0.113.7"));
  });

  it("IPv4-mapped IPv6 is the same client as its IPv4", () => {
    expect(hashClientIp("::ffff:203.0.113.7")).toBe(hashClientIp("203.0.113.7"));
  });

  it('"unknown" keeps its own shared bucket (fail-closed), distinct from every network', () => {
    expect(hashClientIp("unknown")).toBe(hmac("unknown"));
    expect(hashClientIp("unknown")).not.toBe(hashClientIp("::"));
  });

  it("a zone id does not split a bucket", () => {
    expect(hashClientIp("fe80::1%en0")).toBe(hashClientIp("fe80::2%en1"));
  });

  it("is a 64-hex HMAC that carries no part of the address", () => {
    const hash = hashClientIp("2001:db8:abcd:12::1");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("2001");
  });
});

describe("getClientIp feeds the bucket untouched", () => {
  it("passes the trusted header through; absent header is the shared fallback", () => {
    const withIp = new Headers({ "x-vercel-forwarded-for": " 2001:db8::1 " });
    expect(getClientIp({ headers: withIp })).toBe("2001:db8::1");
    expect(getClientIp({ headers: new Headers() })).toBe("unknown");
  });
});
