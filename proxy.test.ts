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
// documents get the request stamped for the bare layout, in English whatever
// the phone says (#445 — the site has no Spanish; an app build that still
// asks for the /es URL is 308'd to the bare one with its query), and nothing
// is written back: no consent default, no visitor id.
describe("proxy — the app's embed of the legal documents", () => {
  // What the page render will see: NextResponse.next/rewrite({ request })
  // forwards request headers as x-middleware-request-*.
  const forwarded = (res: Awaited<ReturnType<typeof proxy>>, name: string) =>
    (res && res.headers.get(`x-middleware-request-${name}`)) ?? null;

  // A first visit from outside the EU — the case where the normal page would
  // default marketing consent ON and mint matio_aid.
  const firstVisit = { "x-vercel-ip-country": "US" };

  it("stamps a bare /terms?embed=app for the bare layout — a Spanish phone too, in place, nothing written", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/terms?embed=app", {
        ...firstVisit,
        "accept-language": "es-ES,es;q=0.9",
        cookie: "locale=es",
      }),
      event,
    );

    expect(forwarded(res, "x-matio-embed")).toBe("app");
    // No language is stamped any more: the page is English for everyone.
    expect(forwarded(res, "x-matio-locale")).toBeNull();
    expect(res?.status).not.toBe(307);
    expect(res?.headers.get("location")).toBeNull();
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("308s the /es embed URL an app build still opens onto the bare one, embed kept, nothing written", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/es/privacy?embed=app", { ...firstVisit, "accept-language": "es-MX" }),
      event,
    );

    expect(res?.status).toBe(308);
    const location = new URL(res!.headers.get("location")!);
    expect(location.pathname).toBe("/privacy");
    expect(location.searchParams.get("embed")).toBe("app");
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

// #376, the owner's option (а): /careers renders without the Meta Pixel and
// GA4 until #341 (lib/ad-pixels.ts). proxy.ts stamps the request for that
// path only; the cookie work — the consent default outside the EU, the
// attribution cookies, matio_aid — is exactly what any other page gets.
describe("proxy — /careers is stamped for a layout without the ad pixels", () => {
  const forwarded = (res: Awaited<ReturnType<typeof proxy>>, name: string) =>
    (res && res.headers.get(`x-middleware-request-${name}`)) ?? null;

  it("a first visit from outside the EU: stamped, and consent + matio_aid written as on any page", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/careers?role=ai-creator&utm_source=ig", { "x-vercel-ip-country": "US" }),
      event,
    );

    expect(forwarded(res, "x-matio-ad-pixels")).toBe("off");
    // The same render still sees the auto-granted consent (banner hidden).
    expect(forwarded(res, "cookie")).toContain("cookie_consent=");
    const setCookie = res?.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("cookie_consent");
    expect(setCookie).toContain("attribution_first");
    expect(setCookie).toContain("matio_aid");
  });

  it("an EU visitor with nothing to write is still stamped", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/careers", { "x-vercel-ip-country": "ES", cookie: "matio_aid=already" }),
      event,
    );

    expect(forwarded(res, "x-matio-ad-pixels")).toBe("off");
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("a neighbour page (/ideas) and the rest are not stamped", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    for (const path of ["/ideas", "/", "/about", "/careers/ai-creator", "/careersx"]) {
      const res = await proxy(request(path, { "x-vercel-ip-country": "US" }), event);
      expect(forwarded(res, "x-matio-ad-pixels"), path).toBeNull();
    }
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

// #445 — the site is English-only. The /es URLs it served until then were
// indexed and linked from ads, so every /es and /es/* is a permanent redirect
// to the bare path with the query intact; and nothing is decided from the
// visitor's language any more — no 307 to an /es twin, no `locale` cookie,
// no locale header for the render.
describe("proxy — the retired /es URLs", () => {
  const forwarded = (res: Awaited<ReturnType<typeof proxy>>, name: string) =>
    (res && res.headers.get(`x-middleware-request-${name}`)) ?? null;
  const setsLocaleCookie = (res: Awaited<ReturnType<typeof proxy>>) =>
    /(?:^|[\s,;])locale=/.test(res?.headers.get("Set-Cookie") ?? "");

  it("308s an /es page to its bare path, keeping ?utm_* and ?fbclid", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(
      request("/es/shows/some-show?utm_source=x&utm_campaign=y&fbclid=abc", {
        "x-vercel-ip-country": "MX",
      }),
      event,
    );

    expect(res?.status).toBe(308);
    const location = new URL(res!.headers.get("location")!);
    expect(location.pathname).toBe("/shows/some-show");
    expect(location.searchParams.get("utm_source")).toBe("x");
    expect(location.searchParams.get("utm_campaign")).toBe("y");
    expect(location.searchParams.get("fbclid")).toBe("abc");
    // The redirect writes nothing — the bare request that follows does.
    expect(res?.headers.get("Set-Cookie")).toBeNull();
  });

  it("308s the /es home, with or without the trailing slash, to /", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    for (const path of ["/es", "/es/", "/es?utm_source=x"]) {
      const res = await proxy(request(path), event);
      expect(res?.status, path).toBe(308);
      const location = new URL(res!.headers.get("location")!);
      expect(location.pathname, path).toBe("/");
      expect(location.search, path).toBe(path.includes("?") ? "?utm_source=x" : "");
    }
  });

  it("redirects every path under /es, never rewrites it — /es/admin lands on /admin, outside any gate bypass", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/es/admin"), event);

    expect(res?.status).toBe(308);
    expect(new URL(res!.headers.get("location")!).pathname).toBe("/admin");
    expect(res?.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("leaves a path that merely starts with the letters alone", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/espanol"), event);

    expect(res?.status).not.toBe(308);
    expect(res?.headers.get("location")).toBeNull();
  });

  it("does not redirect a Spanish browser on a bare page, and sets no locale cookie", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    for (const path of ["/", "/shows/some-show", "/ideas?utm_source=x", "/terms"]) {
      const res = await proxy(
        request(path, {
          "x-vercel-ip-country": "MX",
          "accept-language": "es-MX,es;q=0.9",
        }),
        event,
      );
      expect(res?.status, path).not.toBe(307);
      expect(res?.headers.get("location"), path).toBeNull();
      expect(forwarded(res, "x-matio-locale"), path).toBeNull();
      expect(setsLocaleCookie(res), path).toBe(false);
      // The rest of the landing machinery is untouched.
      expect(res?.headers.get("Set-Cookie"), path).toContain("matio_aid");
    }
  });

  it("ignores an old `locale=es` cookie too", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", undefined);

    const res = await proxy(request("/about", { cookie: "locale=es" }), event);

    expect(res?.status).not.toBe(307);
    expect(res?.headers.get("location")).toBeNull();
    expect(forwarded(res, "x-matio-locale")).toBeNull();
  });

  it("stays behind the staging lock — the bench asks for the password first", async () => {
    vi.stubEnv("STAGING_LOCK_PASSWORD", PASSWORD);

    const locked = await proxy(request("/es/about"), event);
    expect(locked?.status).toBe(401);

    const open = await proxy(
      request("/es/about", authHeader("matio", PASSWORD)),
      event,
    );
    expect(open?.status).toBe(308);
    expect(new URL(open!.headers.get("location")!).pathname).toBe("/about");
  });
});
