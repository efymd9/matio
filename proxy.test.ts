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

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, NextResponse } from "next/server";
import type { NextFetchEvent } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// `server-only` is a build-time marker: outside Next's react-server condition
// its default entry throws on import, and proxy.ts pulls it in through
// lib/free-mode. Neutralised, not worked around — the guard has nothing to
// say inside a node test runner.
vi.mock("server-only", () => ({}));

// What proxy.ts hands clerkMiddleware as its options — the authorized-parties
// wiring is proved below by reading it back. Hoisted so the same record
// survives a module reset (the list is bound at import time from the env).
const clerk = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock("@clerk/nextjs/server", () => ({
  // Mirrors the real contract: hand the handler an `auth()` and turn a
  // "nothing to add" answer into a pass-through response.
  clerkMiddleware: (
    handler: (
      auth: () => Promise<{ userId: string | null }>,
      req: NextRequest,
      event: NextFetchEvent,
    ) => Promise<NextResponse | undefined>,
    options?: unknown,
  ) => {
    clerk.options.push(options);
    return async (req: NextRequest, event: NextFetchEvent) =>
      (await handler(async () => ({ userId: null }), req, event)) ??
      NextResponse.next();
  },
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) =>
    patterns.some((pattern) =>
      new RegExp(`^${pattern.replace("(.*)", "(?:/.*)?")}$`).test(
        req.nextUrl.pathname,
      ),
    ),
}));

const { default: proxy, config } = await import("./proxy");

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

  // Since #419 the matcher keeps /api/healthz out of proxy.ts (proved below),
  // so on the real bench it never reaches this function. What is proved here
  // is the second line: should a matcher change ever route it back in, the
  // lock still lets it through.
  it("keeps /api/healthz open — the uptime check has no password", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/api/healthz"), event);

    expect(res?.status).not.toBe(401);
    // Open, but still not something a crawler should list.
    expect(res?.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("keeps /api/readyz behind the password — #419 left it inside the matcher", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/api/readyz"), event);

    expect(res?.status).toBe(401);
  });

  it("locks the visit beacon — no drive-by rows in the bench's ledger", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/api/t"), event);

    expect(res?.status).toBe(401);
  });
});

// The app's JSON surface skips the landing machinery (#299). Before, a native
// request from outside the consent-required countries got the default-consent
// cookie on its answer — and Vercel's CDN caches no response with Set-Cookie,
// so the public /v1 reads missed their 60s edge copy. Everything else keeps
// the machinery, and Clerk's per-request options are untouched by it.
describe("proxy — /api/v1 answers carry no cookies", () => {
  const nonEu = { "x-vercel-ip-country": "US" };

  it("sets no consent cookie on a /v1 read from a country that defaults consent on", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/api/v1/catalog", nonEu), event);

    expect(res?.headers.get("Set-Cookie")).toBeNull();
    // A plain pass-through: the route answers, nothing is rewritten.
    expect(res?.headers.get("x-middleware-next")).toBe("1");
  });

  it("persists no attribution or _fbc from a /v1 URL, even under consent", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const consented = JSON.stringify({ necessary: true, marketing: true, ts: 1, v: 1 });
    const res = await proxy(
      request("/api/v1/shows/some-show?utm_source=tiktok&utm_campaign=c1&fbclid=abc", {
        ...nonEu,
        cookie: `cookie_consent=${encodeURIComponent(consented)}`,
      }),
      event,
    );

    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("leaves every other path as it was: pages and the web's own /api still get the geo default", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    for (const path of ["/", "/watch/some-show", "/api/playback-token", "/api/v1"]) {
      const res = await proxy(request(path, nonEu), event);
      expect(res?.headers.get("Set-Cookie"), path).toContain("cookie_consent=");
    }
  });

  it("keeps the bench lock in front of /v1 — the lock wraps the proxy, the early return is inside it", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/api/v1/catalog", nonEu), event);

    expect(res?.status).toBe(401);
  });
});

// The list itself is specified in lib/authorized-parties.test.ts; what is
// proved here is that proxy.ts actually hands it to clerkMiddleware, per
// request, and hands NOTHING where the origin is not stable.
describe("proxy — Clerk authorized parties (wiring)", () => {
  type Options =
    | ((req: NextRequest) => { authorizedParties: string[] | undefined })
    | undefined;

  async function importWithEnv(env: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    await import("./proxy");
    return clerk.options.at(-1) as Options;
  }

  it("passes no options on a preview deploy — the reviewer's browser stays signed in", async () => {
    const options = await importWithEnv({
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
    });

    expect(options).toBeUndefined();
  });

  it("passes no options locally", async () => {
    const options = await importWithEnv({
      VERCEL_ENV: undefined,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
    });

    expect(options).toBeUndefined();
  });

  it("hands clerkMiddleware the deployment's own origins on prod, per request", async () => {
    const options = await importWithEnv({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
    });

    expect(typeof options).toBe("function");
    const parties = ["https://matio.tv", "https://www.matio.tv"];
    // A browser request — cookie session, no Authorization header.
    expect(options!(request("/admin"))).toEqual({ authorizedParties: parties });
    // The mobile app — a native Bearer token, which carries no azp, on the
    // one surface it talks to.
    const nativeToken = `x.${btoa(JSON.stringify({ sub: "user_1" }))}.y`;
    expect(
      options!(request("/api/v1/continue", { authorization: `Bearer ${nativeToken}` })),
    ).toEqual({ authorizedParties: undefined });
    // The same token anywhere else is held to the list; so is a header Clerk
    // itself would not read as a token (its parser is case-sensitive).
    expect(
      options!(request("/watch/some-show", { authorization: `Bearer ${nativeToken}` })),
    ).toEqual({ authorizedParties: parties });
    expect(
      options!(request("/api/v1/continue", { authorization: `bearer ${nativeToken}` })),
    ).toEqual({ authorizedParties: parties });
  });

  it("keeps the same per-request decision on /api/v1 now that the handler returns early there (#299)", async () => {
    const options = await importWithEnv({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "matio.tv",
      STAGING_LOCK_PASSWORD: undefined,
    });
    const { default: prodProxy } = await import("./proxy");
    const parties = ["https://matio.tv", "https://www.matio.tv"];
    const nativeToken = `x.${btoa(JSON.stringify({ sub: "user_1" }))}.y`;
    const browserToken = `x.${btoa(JSON.stringify({ sub: "user_1", azp: "https://other-app.example" }))}.y`;
    const native = request("/api/v1/progress", {
      authorization: `Bearer ${nativeToken}`,
      "x-vercel-ip-country": "US",
    });

    // The early return is inside the handler; the options Clerk verifies with
    // are computed for the request exactly as before.
    expect(options!(native)).toEqual({ authorizedParties: undefined });
    expect(
      options!(request("/api/v1/progress", { authorization: `Bearer ${browserToken}` })),
    ).toEqual({ authorizedParties: parties });

    const res = await prodProxy(native, event);
    expect(res?.headers.get("x-middleware-next")).toBe("1");
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });
});

// #310 — a legal document opened by the app (`?embed=app`). The rule itself
// is lib/app-embed.ts; what is proved here is the wiring: exactly the three
// documents (bare and /es) get the request stamped for the bare layout, /es
// is authoritative, a bare URL renders in the language the normal page would
// 307 to — in place, so the embed survives (builds from before #288 open the
// bare /v1/config URL as is) — and nothing is written back: no consent
// default, no visitor id.
describe("proxy — the app's embed of the legal documents", () => {
  // What the page render will see: NextResponse.next/rewrite({ request })
  // forwards request headers as x-middleware-request-*.
  const forwarded = (res: Awaited<ReturnType<typeof proxy>>, name: string) =>
    (res && res.headers.get(`x-middleware-request-${name}`)) ?? null;

  // A first visit from outside the EU — the case where the normal page would
  // default marketing consent ON and mint matio_aid.
  const firstVisit = { "x-vercel-ip-country": "US" };

  it("stamps a bare /terms?embed=app for the bare layout — Spanish phone, Spanish page, no 307", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/terms?embed=app", { ...firstVisit, "accept-language": "es-ES,es;q=0.9" }),
      event,
    );

    expect(forwarded(res, "x-matio-embed")).toBe("app");
    // The same answer the normal page gives by redirecting to /es — here
    // rendered in place, because a 307 would be fine but a lost embed is not.
    expect(forwarded(res, "x-matio-locale")).toBe("es");
    expect(res?.status).not.toBe(307);
    expect(res?.headers.get("location")).toBeNull();
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("renders a bare embed URL in English for an English phone or no header at all", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const en = await proxy(request("/terms?embed=app", { "accept-language": "en-GB,en;q=0.9" }), event);
    const none = await proxy(request("/privacy?embed=app"), event);

    expect(forwarded(en, "x-matio-locale")).toBe("en");
    expect(forwarded(none, "x-matio-locale")).toBe("en");
  });

  it("lets the switcher's cookie decide a bare embed URL, like the normal page", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const es = await proxy(
      request("/cookies?embed=app", { cookie: "locale=es", "accept-language": "en-US" }),
      event,
    );
    const en = await proxy(
      request("/cookies?embed=app", { cookie: "locale=en", "accept-language": "es-ES" }),
      event,
    );

    expect(forwarded(es, "x-matio-locale")).toBe("es");
    expect(forwarded(en, "x-matio-locale")).toBe("en");
  });

  it("rewrites /es/privacy?embed=app onto /privacy, Spanish whatever the phone or cookie says", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/es/privacy?embed=app", {
        ...firstVisit,
        "accept-language": "en-US,en;q=0.9",
        cookie: "locale=en",
      }),
      event,
    );

    const rewrite = new URL(res!.headers.get("x-middleware-rewrite")!);
    expect(rewrite.pathname).toBe("/privacy");
    expect(rewrite.searchParams.get("embed")).toBe("app");
    expect(forwarded(res, "x-matio-embed")).toBe("app");
    expect(forwarded(res, "x-matio-locale")).toBe("es");
    // Not even the sticky locale cookie an /es visit normally sets.
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("covers /cookies too", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/cookies?embed=app"), event);

    expect(forwarded(res, "x-matio-embed")).toBe("app");
  });

  it("leaves the normal legal page exactly as it was", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/terms", firstVisit), event);

    expect(forwarded(res, "x-matio-embed")).toBeNull();
    expect(res?.headers.get("Set-Cookie")).toContain("matio_aid");
    expect(res?.headers.get("Set-Cookie")).toContain("cookie_consent");

    // …and a Spanish browser on it is still sent to the /es twin — the rule
    // the bare embed URL now shares, unchanged for the web.
    const es = await proxy(request("/terms?utm_source=x", { "accept-language": "es-ES,es;q=0.9" }), event);
    expect(es?.status).toBe(307);
    expect(new URL(es!.headers.get("location")!).pathname).toBe("/es/terms");
    const pinned = await proxy(
      request("/terms", { cookie: "locale=en", "accept-language": "es-ES,es;q=0.9" }),
      event,
    );
    expect(pinned?.status).not.toBe(307);
  });

  it("gives no other page an embed variant, and no other value counts", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    for (const path of ["/?embed=app", "/about?embed=app", "/subscribe?embed=app", "/terms?embed=1"]) {
      const res = await proxy(request(path), event);
      expect(forwarded(res, "x-matio-embed")).toBeNull();
    }
  });

  it("stays behind the staging lock", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const res = await proxy(request("/terms?embed=app"), event);

    expect(res?.status).toBe(401);
  });
});

// #419 — /api/healthz never enters proxy.ts. clerkMiddleware throws on every
// request it sees when the Clerk keys are absent (Vercel previews, the #46
// incident), so a health check inside the matcher answered 500 for a reason
// that has nothing to do with the build it reports. /api/readyz stays inside
// on purpose: the production uptime monitor polls it, and its walk through
// proxy.ts is what lets that monitor see a middleware outage between
// releases. Asked through Next's own matcher compiler — the same code the
// build runs — so what is proved is what Vercel will route, not a
// hand-written regex.
describe("proxy — the matcher keeps /api/healthz out, and only it", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, url, nextConfig: {} });

  it("does not run on /api/healthz", () => {
    for (const path of ["/api/healthz", "/api/healthz/"]) {
      expect(matches(path), path).toBe(false);
    }
    expect(matches("/api/healthz?probe=1"), "with a query").toBe(false);
  });

  it("still runs on /api/readyz — the uptime monitor relies on it", () => {
    for (const path of ["/api/readyz", "/api/readyz/", "/api/readyz?probe=1"]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("still runs everywhere else — pages, the web's /api, the app's /api/v1", () => {
    for (const path of [
      "/",
      "/shows/some-show",
      "/es/about",
      "/watch/some-show",
      "/admin",
      "/api/playback-token",
      "/api/t",
      // The release smoke's middleware check (deploy-production.yml): it
      // only proves Clerk is alive while this path stays inside the matcher.
      "/api/v1/config",
      "/api/v1/continue",
    ]) {
      expect(matches(path), path).toBe(true);
    }
  });

  it("excludes exactly that path, not everything that starts like it", () => {
    // The same precision as the staging lock's open paths
    // (lib/staging-lock.ts): a look-alike stays behind the middleware.
    for (const path of ["/api/healthz-debug", "/api/healthz/secret", "/api/healthzz"]) {
      expect(matches(path), path).toBe(true);
    }
  });
});

// #297 — /ideas joined the localized set through lib/seo.ts alone; proxy.ts
// was not touched. What is proved here is that the wiring picks it up: a
// Spanish-preferring person landing on the bare URL from an ad is sent to
// the /es twin with the campaign parameters intact.
describe("proxy — the /ideas landing is a localized page", () => {
  it("307s a Spanish browser from /ideas to /es/ideas, keeping ?utm_*", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/ideas?utm_source=x", { "accept-language": "es-MX,es;q=0.9" }),
      event,
    );

    expect(res?.status).toBe(307);
    const location = new URL(res!.headers.get("location")!);
    expect(location.pathname).toBe("/es/ideas");
    expect(location.searchParams.get("utm_source")).toBe("x");
  });
});
