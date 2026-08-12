// Unit tests for lib/staging-lock.ts — the password lock that stands in front
// of the staging bench. These assert the two answers that matter: who gets in,
// and what the door says to everyone else. A lock that is wrong in either
// direction is either an open bench or a bench nobody (including the uptime
// check) can reach.

import { describe, expect, it } from "vitest";

import {
  evaluateStagingLock,
  hasStagingLockCredentials,
  isStagingLockOpenPath,
  NOINDEX_VALUE,
  STAGING_LOCK_CHALLENGE,
  stagingLockChallenge,
} from "./staging-lock";

// Obviously fake, so the nightly gitleaks scan has nothing to investigate.
const PASSWORD = "dummy-staging-password";

// What a browser actually sends: the credentials are UTF-8 encoded first, then
// base64'd. Plain `btoa` cannot even represent a non-ASCII password.
const encode = (value: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(value)));

const basic = (user: string, pass: string) => `Basic ${encode(`${user}:${pass}`)}`;

describe("isStagingLockOpenPath", () => {
  it("leaves the health endpoint open — uptime pings carry no credentials", () => {
    expect(isStagingLockOpenPath("/api/healthz")).toBe(true);
    expect(isStagingLockOpenPath("/api/healthz/")).toBe(true);
  });

  it("locks everything else, including the rest of the API", () => {
    // /api/t writes the visitor ledger: an open beacon would fill the bench's
    // tables with drive-by traffic.
    expect(isStagingLockOpenPath("/api/t")).toBe(false);
    expect(isStagingLockOpenPath("/")).toBe(false);
    expect(isStagingLockOpenPath("/admin")).toBe(false);
    // Not a prefix match — a path that merely starts the same stays locked.
    expect(isStagingLockOpenPath("/api/healthz-debug")).toBe(false);
    expect(isStagingLockOpenPath("/api/healthz/secret")).toBe(false);
  });
});

describe("hasStagingLockCredentials", () => {
  it("accepts the password under any username", () => {
    expect(hasStagingLockCredentials(basic("owner", PASSWORD), PASSWORD)).toBe(true);
    expect(hasStagingLockCredentials(basic("", PASSWORD), PASSWORD)).toBe(true);
  });

  it("is case-insensitive about the scheme and tolerates spacing", () => {
    expect(hasStagingLockCredentials(`basic ${btoa(`x:${PASSWORD}`)}`, PASSWORD)).toBe(true);
    expect(
      hasStagingLockCredentials(`  BASIC   ${btoa(`x:${PASSWORD}`)}  `, PASSWORD),
    ).toBe(true);
  });

  it("keeps a password that contains a colon intact", () => {
    const withColon = "dummy:pass:word";
    expect(hasStagingLockCredentials(basic("owner", withColon), withColon)).toBe(true);
  });

  it("matches a non-ASCII password (the header is UTF-8, not latin1)", () => {
    const cyrillic = "пароль-заглушка";
    expect(hasStagingLockCredentials(basic("owner", cyrillic), cyrillic)).toBe(true);
  });

  it("rejects a wrong password, a missing header and malformed credentials", () => {
    expect(hasStagingLockCredentials(basic("owner", "wrong"), PASSWORD)).toBe(false);
    expect(hasStagingLockCredentials(null, PASSWORD)).toBe(false);
    expect(hasStagingLockCredentials(undefined, PASSWORD)).toBe(false);
    expect(hasStagingLockCredentials("", PASSWORD)).toBe(false);
    // Another scheme entirely.
    expect(hasStagingLockCredentials(`Bearer ${btoa(`x:${PASSWORD}`)}`, PASSWORD)).toBe(false);
    // Scheme with no credentials at all.
    expect(hasStagingLockCredentials("Basic", PASSWORD)).toBe(false);
    // Not base64.
    expect(hasStagingLockCredentials("Basic ???", PASSWORD)).toBe(false);
    // Valid base64 without the user:pass separator.
    expect(hasStagingLockCredentials(`Basic ${btoa(PASSWORD)}`, PASSWORD)).toBe(false);
    // A prefix of the password must not pass.
    expect(hasStagingLockCredentials(basic("owner", PASSWORD.slice(0, -1)), PASSWORD)).toBe(
      false,
    );
  });
});

describe("evaluateStagingLock", () => {
  it("challenges an anonymous request to a normal page", () => {
    expect(evaluateStagingLock(PASSWORD, "/", null)).toBe("challenge");
    expect(evaluateStagingLock(PASSWORD, "/watch/demo", basic("owner", "wrong"))).toBe(
      "challenge",
    );
  });

  it("lets the password through", () => {
    expect(evaluateStagingLock(PASSWORD, "/", basic("owner", PASSWORD))).toBe("allow");
  });

  it("lets /api/healthz through without any credentials", () => {
    expect(evaluateStagingLock(PASSWORD, "/api/healthz", null)).toBe("allow");
  });
});

describe("stagingLockChallenge", () => {
  it("is a 401 the browser can answer, and is not indexable", async () => {
    const res = stagingLockChallenge();

    expect(res.status).toBe(401);
    // Without this exact header the browser shows a bare error page instead of
    // the password prompt — the lock would look broken rather than locked.
    expect(res.headers.get("WWW-Authenticate")).toBe(STAGING_LOCK_CHALLENGE);
    expect(STAGING_LOCK_CHALLENGE).toBe('Basic realm="matio staging"');
    expect(res.headers.get("X-Robots-Tag")).toBe(NOINDEX_VALUE);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain("password required");
  });
});
