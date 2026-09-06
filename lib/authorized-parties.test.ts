import { describe, expect, it } from "vitest";

import {
  authorizedPartiesForRequest,
  resolveAuthorizedParties,
} from "./authorized-parties";

// Two failure modes bracket every case here. Too NARROW a list signs real
// browsers out (a reviewer on a preview, the owner on the bench, everyone on
// prod after a mis-set variable). Too WIDE a list — or none — is the hole #100
// closes. So each case asserts the exact list, not just "something came back".

const SITE = ["https://matio.tv", "https://www.matio.tv"];

describe("resolveAuthorizedParties — production deployments", () => {
  it("lists the apex and its www twin on prod, from Vercel's own variable", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
      }),
    ).toEqual(SITE);
  });

  it("always carries the canonical site — even with both variables missing", () => {
    // The safety net: a valid-but-wrong variable (the legacy alias, say)
    // must not produce a list WITHOUT the apex, which would sign prod out.
    expect(resolveAuthorizedParties({ VERCEL_ENV: "production" })).toEqual(SITE);
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio-ten.vercel.app",
      }),
    ).toEqual(["https://matio-ten.vercel.app", ...SITE]);
  });

  it("does not duplicate an origin NEXT_PUBLIC_APP_URL repeats", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
        NEXT_PUBLIC_APP_URL: "https://matio.tv",
      }),
    ).toEqual(SITE);
  });

  it("lists the bench's own *.vercel.app host — no www twin for it — next to the site", () => {
    // The bench is the production deployment of its own Vercel project, so
    // VERCEL_ENV is `production` there too; APP_ENV is not what decides. The
    // apex rides along harmlessly: a matio.tv token is signed by the other
    // Clerk instance and fails the signature there.
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        APP_ENV: "staging",
        VERCEL_PROJECT_PRODUCTION_URL: "matio-staging.vercel.app",
      }),
    ).toEqual(["https://matio-staging.vercel.app", ...SITE]);
  });

  it("normalises a www host to the same apex-first pair", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "www.matio.tv",
      }),
    ).toEqual(SITE);
  });

  it("keeps only the origin of a full URL, port included", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "https://matio.tv:8443/some/path?x=1",
      }),
    ).toEqual(["https://matio.tv:8443", "https://www.matio.tv:8443", ...SITE]);
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
      ...SITE,
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

describe("resolveAuthorizedParties — garbage is skipped, the site stays", () => {
  it("skips unparseable and non-https values", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "not a host name",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      }),
    ).toEqual(SITE);
  });

  it("treats blank variables as absent", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "",
        NEXT_PUBLIC_APP_URL: "",
      }),
    ).toEqual(SITE);
  });

  it("still lists the good origin next to a bad one", () => {
    expect(
      resolveAuthorizedParties({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "matio-staging.vercel.app",
        NEXT_PUBLIC_APP_URL: "ftp://nope",
      }),
    ).toEqual(["https://matio-staging.vercel.app", ...SITE]);
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
const NATIVE = jwt({ sub: "user_1", sid: "sess_1", iss: "https://clerk.matio.tv" });
const BROWSER = jwt({ sub: "user_1", azp: "https://evil.example" });
const API = "/api/v1/continue";

describe("authorizedPartiesForRequest — outside /api/v1 the list always applies", () => {
  it("is a no-op where no list applies (preview, local)", () => {
    expect(authorizedPartiesForRequest(undefined, null, "/")).toBeUndefined();
    expect(
      authorizedPartiesForRequest(undefined, `Bearer ${NATIVE}`, API),
    ).toBeUndefined();
  });

  it("holds every web request to the list, whatever the header says", () => {
    for (const path of ["/", "/watch/some-show", "/admin", "/api/playback-token", "/api/v1"]) {
      expect(authorizedPartiesForRequest(PARTIES, null, path)).toBe(PARTIES);
      expect(authorizedPartiesForRequest(PARTIES, `Bearer ${NATIVE}`, path)).toBe(PARTIES);
    }
  });
});

describe("authorizedPartiesForRequest — on /api/v1", () => {
  it("holds a browser (cookie) request to the list — no Authorization header", () => {
    expect(authorizedPartiesForRequest(PARTIES, null, API)).toBe(PARTIES);
    expect(authorizedPartiesForRequest(PARTIES, undefined, API)).toBe(PARTIES);
    expect(authorizedPartiesForRequest(PARTIES, "", API)).toBe(PARTIES);
  });

  it("holds a Bearer token that names a party to the list — foreign origins included", () => {
    expect(authorizedPartiesForRequest(PARTIES, `Bearer ${BROWSER}`, API)).toBe(PARTIES);
  });

  it("exempts a Bearer token with no azp — a native (@clerk/expo) session", () => {
    // Native tokens are minted with no browser Origin, so they carry no azp.
    // @clerk/backend 3.17 would reject them against ANY list; the list is
    // withheld for them and the token still meets signature/expiry checks.
    expect(authorizedPartiesForRequest(PARTIES, `Bearer ${NATIVE}`, API)).toBeUndefined();
  });

  it("reads the header exactly as Clerk does: a lowercase `bearer` is NOT a token", () => {
    // Clerk's parser is case-sensitive — `bearer x` yields no header token, so
    // Clerk verifies the COOKIE. Withholding the list here would let a cookie
    // session through without its azp checked: the list must stay.
    expect(authorizedPartiesForRequest(PARTIES, `bearer ${NATIVE}`, API)).toBe(PARTIES);
    expect(authorizedPartiesForRequest(PARTIES, `BEARER ${NATIVE}`, API)).toBe(PARTIES);
  });

  it("reads the header exactly as Clerk does: a bare value with no scheme IS the token", () => {
    expect(authorizedPartiesForRequest(PARTIES, NATIVE, API)).toBeUndefined();
    expect(authorizedPartiesForRequest(PARTIES, BROWSER, API)).toBe(PARTIES);
  });

  it("reads the header exactly as Clerk does: a lone `Bearer` is the token Clerk will (fail to) verify", () => {
    // Clerk takes the header path with the word itself as the token and
    // rejects it there — the cookie is never consulted, so withholding is moot.
    expect(authorizedPartiesForRequest(PARTIES, "Bearer", API)).toBeUndefined();
  });

  it("does not treat a non-Bearer scheme as a token — the bench's Basic lock, a stray header", () => {
    expect(authorizedPartiesForRequest(PARTIES, "Basic eDpzZWNyZXQ=", API)).toBe(PARTIES);
    expect(authorizedPartiesForRequest(PARTIES, `Token ${NATIVE}`, API)).toBe(PARTIES);
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
    expect(authorizedPartiesForRequest(PARTIES, `Bearer ${token}`, API)).toBe(PARTIES);
  });

  it("mirrors Clerk's own reading of an empty azp as 'no azp'", () => {
    expect(
      authorizedPartiesForRequest(PARTIES, `Bearer ${jwt({ sub: "user_1", azp: "" })}`, API),
    ).toBeUndefined();
  });

  it("withholds the list from a header token it cannot read — Clerk rejects that token on the header path anyway", () => {
    expect(authorizedPartiesForRequest(PARTIES, "Bearer not-a-jwt", API)).toBeUndefined();
    expect(authorizedPartiesForRequest(PARTIES, "Bearer a.%%%.c", API)).toBeUndefined();
    // Valid base64, not an object.
    expect(
      authorizedPartiesForRequest(
        PARTIES,
        `Bearer a.${Buffer.from('"just a string"').toString("base64url")}.c`,
        API,
      ),
    ).toBeUndefined();
  });
});
