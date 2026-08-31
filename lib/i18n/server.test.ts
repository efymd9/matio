import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// getLocale() resolves the request locale through a fixed ladder: URL header
// (set by the /es rewrite) → sticky switcher cookie → Accept-Language. What is
// asserted here is that ladder — especially that step 3 no longer consults geo
// (issue #139), so `x-vercel-ip-country` can't drag a non-Spanish browser to es.
const h = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => h.headers.get(k) ?? null }),
  cookies: async () => ({
    get: (k: string) => {
      const value = h.cookies.get(k);
      return value === undefined ? undefined : { value };
    },
  }),
}));

import { getLocale } from "./server";

beforeEach(() => {
  h.headers = new Map();
  h.cookies = new Map();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getLocale — resolution ladder", () => {
  it("honours the URL-derived header above everything (canonical/hreflang can't lie)", async () => {
    h.headers.set("x-matio-locale", "es");
    h.cookies.set("locale", "en"); // even a conflicting sticky cookie loses
    await expect(getLocale()).resolves.toBe("es");
  });

  it("honours the sticky switcher cookie when no URL locale is present", async () => {
    h.cookies.set("locale", "es");
    h.headers.set("accept-language", "en-US,en"); // header would say en
    await expect(getLocale()).resolves.toBe("es");
  });

  it("falls to Accept-Language negotiation last — and ignores geo entirely", async () => {
    // The #139 fix: a Russian browser physically in Spain gets English.
    h.headers.set("accept-language", "ru-RU,ru;q=0.9");
    h.headers.set("x-vercel-ip-country", "ES");
    await expect(getLocale()).resolves.toBe("en");
  });

  it("still gives Spanish to an es Accept-Language", async () => {
    h.headers.set("accept-language", "es-ES,es;q=0.9");
    await expect(getLocale()).resolves.toBe("es");
  });

  it("defaults to English when nothing is present (the Googlebot case)", async () => {
    await expect(getLocale()).resolves.toBe("en");
  });
});
