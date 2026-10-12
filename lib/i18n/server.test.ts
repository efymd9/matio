import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The site is English-only since #445. What used to be a resolution ladder
// (the /es URL header → the switcher's `locale` cookie → Accept-Language) is
// gone; what is asserted here is that every one of those old signals is now
// ignored — a Spanish request still renders English.
const h = vi.hoisted(() => ({
  headers: new Map<string, string>([
    ["x-matio-locale", "es"],
    ["accept-language", "es-ES,es;q=0.9"],
  ]),
  cookies: new Map<string, string>([["locale", "es"]]),
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

import { en } from "./dictionaries";
import { getDict, getLocale } from "./server";

describe("getLocale / getDict — the site speaks English only (#445)", () => {
  it("answers English even when every old Spanish signal is present", async () => {
    await expect(getLocale()).resolves.toBe("en");
  });

  it("hands back the English dictionary with it", async () => {
    const { locale, t } = await getDict();
    expect(locale).toBe("en");
    expect(t).toBe(en);
    expect(t.htmlLang).toBe("en");
  });
});
