import { describe, expect, it } from "vitest";

import {
  authorizedPartiesForRequest,
  resolveAuthorizedParties,
} from "./authorized-parties";

// Two failure modes bracket every case here. Too NARROW a list signs real
// browsers out (a reviewer on a preview, the owner on the bench, everyone on
// prod after a mis-set variable). Too WIDE a list — or none — is the hole #100
// closes. So each case asserts the exact list, not just "something came back".

describe("resolveAuthorizedParties — production deployments", () => {
  it("lists the apex and its www twin on prod, from Vercel's own variable", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
      }),
    ).toEqual(["https://matio.tv", "https://www.matio.tv"]);
  });

  it("does not duplicate an origin NEXT_PUBLIC_APP_URL repeats", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
        NEXT_PUBLIC_APP_URL: "https://matio.tv",
      }),
    ).toEqual(["https://matio.tv", "https://www.matio.tv"]);
  });

  it("lists the bench's own *.vercel.app host — and no www twin for it", () => {
    // The bench is the production deployment of its own Vercel project, so
    // VERCEL_ENV is `production` there too; APP_ENV is not what decides.
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        APP_ENV: "staging",
        VERCEL_PROJECT_PRODUCTION_URL: "matio-staging.vercel.app",
      }),
    ).toEqual(["https://matio-staging.vercel.app"]);
  });

  it("normalises a www host to the same apex-first pair", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "www.matio.tv",
      }),
    ).toEqual(["https://matio.tv", "https://www.matio.tv"]);
  });

  it("keeps only the origin of a full URL, port included", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "https://matio.tv:8443/some/path?x=1",
      }),
    ).toEqual(["https://matio.tv:8443", "https://www.matio.tv:8443"]);
  });

  it("adds a distinct https NEXT_PUBLIC_APP_URL as a further origin", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio-staging.vercel.app",
        NEXT_PUBLIC_APP_URL: "https://bench.example/",
      }),
    ).toEqual([
      "https://matio-staging.vercel.app",
      "https://bench.example",
      "https://www.bench.example",
    ]);
  });
});

describe("resolveAuthorizedParties — where the origin cannot be enumerated", () => {
  it("returns undefined on a Vercel preview — its URL is minted per commit", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
        NEXT_PUBLIC_APP_URL: "https://matio-git-fix-x-mad-matttts-projects.vercel.app",
      }),
    ).toBeUndefined();
  });

  it("returns undefined locally — no Vercel target, a localhost app URL", () => {
    expect(resolveAuthorizedParties({})).toBeUndefined();
    expect(
      resolveAuthorizedParties({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toBeUndefined();
  });
});

describe("resolveAuthorizedParties — garbage degrades to 'no list', never to 'nobody'", () => {
  it("skips unparseable and non-https values", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "not a host name",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toBeUndefined();
  });

  it("treats blank variables as absent", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "",
        NEXT_PUBLIC_APP_URL: "",
      }),
    ).toBeUndefined();
  });

  it("still lists the good origin next to a bad one", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
        NEXT_PUBLIC_APP_URL: "ftp://nope",
      }),
    ).toEqual(["https://matio.tv", "https://www.matio.tv"]);
  });
});

// A JWT the way Clerk shapes one: base64url segments, no padding. Unsigned —
// the peek reads the payload only; verification is Clerk's job, not ours.
function jwt(claims: unknown): string {
  return [
    "eyJhbGciOiJSUzI1NiJ9",
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "dummy-signature",
  ].join(".");
}

const PARTIES = ["https://matio.tv", "https://www.matio.tv"];

describe("authorizedPartiesForRequest", () => {
  it("is a no-op where no list applies (preview, local)", () => {
    expect(authorizedPartiesForRequest(undefined, null)).toBeUndefined();
    expect(
      authorizedPartiesForRequest(undefined, `Bearer ${jwt({ sub: "user_1" })}`),
    ).toBeUndefined();
  });

  it("holds a browser (cookie) request to the list — no Authorization header", () => {
    expect(authorizedPartiesForRequest(PARTIES, null)).toBe(PARTIES);
    expect(authorizedPartiesForRequest(PARTIES, undefined)).toBe(PARTIES);
  });

  it("holds a Bearer token that names a party to the list — foreign origins included", () => {
    expect(
      authorizedPartiesForRequest(
        PARTIES,
        `Bearer ${jwt({ sub: "user_1", azp: "https://evil.example" })}`,
      ),
    ).toBe(PARTIES);
    expect(
      authorizedPartiesForRequest(
        PARTIES,
        `bearer ${jwt({ sub: "user_1", azp: "https://matio.tv" })}`,
      ),
    ).toBe(PARTIES);
  });

  it("exempts a Bearer token with no azp — a native (@clerk/expo) session", () => {
    // Native tokens are minted with no browser Origin, so they carry no azp.
    // @clerk/backend 3.17 would reject them against ANY list; the list is
    // withheld for them and the token still meets signature/expiry checks.
    expect(
      authorizedPartiesForRequest(
        PARTIES,
        `Bearer ${jwt({ sub: "user_1", sid: "sess_1", iss: "https://clerk.matio.tv" })}`,
      ),
    ).toBeUndefined();
  });

  it("decodes real base64url payloads — no padding, URL-safe alphabet, UTF-8", () => {
    // A payload long enough to need padding and containing bytes that
    // base64url encodes with `-` / `_`, plus a non-ASCII claim.
    const claims = {
      sub: "user_1",
      azp: "https://matio.tv",
      name: "Матвей — «Matio» ~~~???>>>",
      pad: "x".repeat(37),
    };
    const token = jwt(claims);
    expect(token).not.toContain("=");
    expect(authorizedPartiesForRequest(PARTIES, `Bearer ${token}`)).toBe(PARTIES);
  });

  it("mirrors Clerk's own reading of an empty azp as 'no azp'", () => {
    expect(
      authorizedPartiesForRequest(PARTIES, `Bearer ${jwt({ sub: "user_1", azp: "" })}`),
    ).toBeUndefined();
  });

  it("withholds the list from a token it cannot read — Clerk rejects that token anyway", () => {
    expect(authorizedPartiesForRequest(PARTIES, "Bearer not-a-jwt")).toBeUndefined();
    expect(authorizedPartiesForRequest(PARTIES, "Bearer a.%%%.c")).toBeUndefined();
    // Valid base64, not an object.
    expect(
      authorizedPartiesForRequest(
        PARTIES,
        `Bearer a.${Buffer.from('"just a string"').toString("base64url")}.c`,
      ),
    ).toBeUndefined();
  });

  it("does not treat a non-Bearer Authorization header as a token", () => {
    // The bench's Basic-Auth lock rides the same header.
    expect(authorizedPartiesForRequest(PARTIES, "Basic eDpzZWNyZXQ=")).toBe(PARTIES);
  });
});
