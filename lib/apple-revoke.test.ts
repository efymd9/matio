import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  APPLE_CLIENT_ID,
  APPLE_REQUEST_TIMEOUT_MS,
  appleAuthorizationCode,
  revokeAppleAuthorization,
} from "./apple-revoke";

// #407 — Sign in with Apple's grant revoked when the account is deleted:
// the fresh authorization code the app sends is exchanged at Apple's
// /auth/token and the refresh token it yields revoked at /auth/revoke. Apple
// is a fake `fetch` here; the key is generated per run (nothing key-shaped is
// committed), and the client secret is checked against its public half.

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CODE = "c0de-dummy-apple-authorization";
const REFRESH = "r-dummy-refresh-token";
const ACCESS = "a-dummy-access-token";

type Call = { url: string; form: URLSearchParams; init: RequestInit };
let calls: Call[];
let answers: Array<() => Promise<Response>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const tokenOk = () => Promise.resolve(json(200, { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: "Bearer", id_token: "eyJ.dummy.id" }));
const revokeOk = () => Promise.resolve(new Response(null, { status: 200 }));

beforeEach(() => {
  calls = [];
  answers = [];
  vi.stubEnv("APPLE_TEAM_ID", "TEAMDUMMY1");
  vi.stubEnv("APPLE_SIGN_IN_KEY_ID", "KEYDUMMY01");
  vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", PEM);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(String(init.body)), init });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("appleAuthorizationCode — what the delete request's body may carry", () => {
  it("takes a non-empty string, trimmed", () => {
    expect(appleAuthorizationCode({ appleAuthorizationCode: `  ${CODE} ` })).toBe(CODE);
  });

  it.each([
    ["no body (a build from before #407)", undefined],
    ["null", null],
    ["a string body", "code"],
    ["an empty object", {}],
    ["an empty code", { appleAuthorizationCode: "  " }],
    ["a number", { appleAuthorizationCode: 42 }],
    ["something far too long to be a code", { appleAuthorizationCode: "x".repeat(1025) }],
  ])("reads %s as no code", (_label, body) => {
    expect(appleAuthorizationCode(body)).toBeUndefined();
  });
});

describe("revokeAppleAuthorization — skips that send nothing to Apple", () => {
  it("no code → skipped_no_code, whatever the env", async () => {
    expect(await revokeAppleAuthorization(undefined)).toEqual({ status: "skipped_no_code" });
    expect(calls).toHaveLength(0);
  });

  it.each(["APPLE_TEAM_ID", "APPLE_SIGN_IN_KEY_ID", "APPLE_SIGN_IN_PRIVATE_KEY"])(
    "a code but no %s → skipped_unconfigured, and no request",
    async (name) => {
      vi.stubEnv(name, "");
      expect(await revokeAppleAuthorization(CODE)).toEqual({ status: "skipped_unconfigured" });
      expect(calls).toHaveLength(0);
    },
  );

  it("a key that will not sign → failed at client_secret, and no request", async () => {
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----\\ninvalid\\n-----END PRIVATE KEY-----");

    const result = await revokeAppleAuthorization(CODE);

    expect(result).toMatchObject({ status: "failed", step: "client_secret" });
    expect(calls).toHaveLength(0);
  });
});

describe("revokeAppleAuthorization — the exchange and the revocation", () => {
  it("exchanges the code, then revokes the refresh token it yields → revoked", async () => {
    answers = [tokenOk, revokeOk];

    expect(await revokeAppleAuthorization(CODE)).toEqual({ status: "revoked" });

    expect(calls.map((c) => c.url)).toEqual([
      "https://appleid.apple.com/auth/token",
      "https://appleid.apple.com/auth/revoke",
    ]);
    const [token, revoke] = calls;
    expect(token.init.method).toBe("POST");
    expect(new Headers(token.init.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(token.form.get("client_id")).toBe(APPLE_CLIENT_ID);
    expect(token.form.get("grant_type")).toBe("authorization_code");
    expect(token.form.get("code")).toBe(CODE);
    // A code from the native sheet was requested without one.
    expect(token.form.has("redirect_uri")).toBe(false);
    expect(revoke.form.get("client_id")).toBe(APPLE_CLIENT_ID);
    expect(revoke.form.get("token")).toBe(REFRESH);
    expect(revoke.form.get("token_type_hint")).toBe("refresh_token");
    // Both requests are bounded.
    expect(token.init.signal).toBeInstanceOf(AbortSignal);
    expect(revoke.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("signs the client secret the way Apple documents it: ES256, kid, iss = team, sub = the App ID, aud = appleid, short-lived", async () => {
    answers = [tokenOk, revokeOk];
    await revokeAppleAuthorization(CODE);

    for (const call of calls) {
      const secret = call.form.get("client_secret") ?? "";
      const decoded = jwt.decode(secret, { complete: true });
      expect(decoded?.header).toMatchObject({ alg: "ES256", kid: "KEYDUMMY01" });
      const claims = jwt.verify(secret, publicKey, { algorithms: ["ES256"] }) as jwt.JwtPayload;
      expect(claims).toMatchObject({
        iss: "TEAMDUMMY1",
        sub: "tv.matio.app",
        aud: "https://appleid.apple.com",
      });
      expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(300);
    }
  });

  it.each([
    ["the .p8 with `\\n`-escaped newlines (a one-line env var)", PEM.replace(/\n/g, "\\n")],
    ["base64 of the .p8 (the MUX_SIGNING_KEY_PRIVATE_KEY convention)", Buffer.from(PEM).toString("base64")],
  ])("accepts %s", async (_label, value) => {
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", value);
    answers = [tokenOk, revokeOk];

    expect(await revokeAppleAuthorization(CODE)).toEqual({ status: "revoked" });
    expect(() =>
      jwt.verify(calls[0].form.get("client_secret") ?? "", publicKey, { algorithms: ["ES256"] }),
    ).not.toThrow();
  });

  it("revokes the access token when the exchange returns no refresh token", async () => {
    answers = [() => Promise.resolve(json(200, { access_token: ACCESS })), revokeOk];

    expect(await revokeAppleAuthorization(CODE)).toEqual({ status: "revoked" });
    expect(calls[1].form.get("token")).toBe(ACCESS);
    expect(calls[1].form.get("token_type_hint")).toBe("access_token");
  });

  it("a 200 with no token at all is a failure at the exchange, and nothing is revoked", async () => {
    answers = [() => Promise.resolve(json(200, { token_type: "Bearer" }))];

    expect(await revokeAppleAuthorization(CODE)).toEqual({
      status: "failed",
      step: "token",
      httpStatus: 200,
      appleError: "no_token",
    });
    expect(calls).toHaveLength(1);
  });
});

describe("revokeAppleAuthorization — Apple refusing or not answering", () => {
  it("an expired or used code (400 invalid_grant) → failed at token, with Apple's code and nothing else", async () => {
    answers = [() => Promise.resolve(json(400, { error: "invalid_grant", error_description: `code ${CODE} expired` }))];

    const result = await revokeAppleAuthorization(CODE);

    expect(result).toEqual({
      status: "failed",
      step: "token",
      httpStatus: 400,
      appleError: "invalid_grant",
    });
    expect(JSON.stringify(result)).not.toContain(CODE);
    expect(calls).toHaveLength(1);
  });

  it("an error outside Apple's documented list, or no JSON at all, reads as `other`", async () => {
    answers = [() => Promise.resolve(json(400, { error: "something_new" }))];
    expect(await revokeAppleAuthorization(CODE)).toMatchObject({ appleError: "other" });

    answers = [() => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 }))];
    expect(await revokeAppleAuthorization(CODE)).toEqual({
      status: "failed",
      step: "token",
      httpStatus: 502,
      appleError: "other",
    });
  });

  it("a revocation Apple refuses (400 invalid_client — a wrong key) → failed at revoke; the token never comes back", async () => {
    answers = [tokenOk, () => Promise.resolve(json(400, { error: "invalid_client" }))];

    const result = await revokeAppleAuthorization(CODE);

    expect(result).toEqual({
      status: "failed",
      step: "revoke",
      httpStatus: 400,
      appleError: "invalid_client",
    });
    expect(JSON.stringify(result)).not.toContain(REFRESH);
  });

  it("an exchange that times out → failed at token by class, never thrown", async () => {
    answers = [() => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))];

    expect(await revokeAppleAuthorization(CODE)).toEqual({
      status: "failed",
      step: "token",
      error: { name: "TimeoutError", code: undefined, statusCode: undefined },
    });
    expect(APPLE_REQUEST_TIMEOUT_MS).toBe(5_000);
  });

  it("a revocation that drops (network) → failed at revoke by class, never thrown", async () => {
    answers = [tokenOk, () => Promise.reject(Object.assign(new TypeError("fetch failed"), { code: "ECONNRESET" }))];

    expect(await revokeAppleAuthorization(CODE)).toEqual({
      status: "failed",
      step: "revoke",
      error: { name: "TypeError", code: "ECONNRESET", statusCode: undefined },
    });
  });
});
