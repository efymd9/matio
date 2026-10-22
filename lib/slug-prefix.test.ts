import { describe, expect, it } from "vitest";

import {
  SLUG_PREFIX_MIN_LENGTH,
  normalizeSlugPrefix,
  resolveSlugByPrefix,
  withSearchParams,
} from "./slug-prefix";

// The live catalog on 22.10.2026 (sitemap.xml) — two shows share `the-`.
const CATALOG = [
  "cartero-mundo",
  "fallen",
  "juego-de-seduccion",
  "morelli",
  "protocol-1500",
  "quedate-conmigo",
  "second-hand",
  "the-heather-oath-two-blades",
  "the-scarlet-oath",
] as const;

describe("normalizeSlugPrefix — what YouTube's truncation leaves behind", () => {
  it("strips trailing dots in any mix and lowercases", () => {
    expect(normalizeSlugPrefix("the-scarlet-oa..")).toBe("the-scarlet-oa");
    expect(normalizeSlugPrefix("the-scarlet-oa.")).toBe("the-scarlet-oa");
    expect(normalizeSlugPrefix("the-scarlet-oa…")).toBe("the-scarlet-oa");
    expect(normalizeSlugPrefix("the-scarlet-oa.…")).toBe("the-scarlet-oa");
    expect(normalizeSlugPrefix("The-Scarlet-OA..")).toBe("the-scarlet-oa");
  });

  it("leaves a dot that is not trailing alone — it simply matches nothing", () => {
    expect(normalizeSlugPrefix("the.scarlet-oa")).toBe("the.scarlet-oa");
  });
});

describe("resolveSlugByPrefix — exactly one published slug starts with the prefix", () => {
  it("the YouTube link: `the-scarlet-oa..` / `.` / bare → the-scarlet-oath", () => {
    expect(resolveSlugByPrefix("the-scarlet-oa..", CATALOG)).toBe("the-scarlet-oath");
    expect(resolveSlugByPrefix("the-scarlet-oa.", CATALOG)).toBe("the-scarlet-oath");
    expect(resolveSlugByPrefix("the-scarlet-oa", CATALOG)).toBe("the-scarlet-oath");
    expect(resolveSlugByPrefix("the-scarlet-oa…", CATALOG)).toBe("the-scarlet-oath");
  });

  it("letter case is folded — slugs are lowercase, a retyped link may not be", () => {
    expect(resolveSlugByPrefix("The-Scarlet-OA..", CATALOG)).toBe("the-scarlet-oath");
  });

  it("no match → null", () => {
    expect(resolveSlugByPrefix("nonexistent-show", CATALOG)).toBeNull();
    expect(resolveSlugByPrefix("nonexistent-show..", CATALOG)).toBeNull();
    expect(resolveSlugByPrefix("the-scarlet-oa..", [])).toBeNull();
  });

  it("two or more matches → null (a second `the-scarlet-oath-…` show makes the YouTube prefix ambiguous)", () => {
    // In the real catalog the shared prefix `the-` is also too short, so the
    // ambiguity is built at a length the rule accepts.
    const twoOaths = [...CATALOG, "the-scarlet-oath-season-2"];
    expect(resolveSlugByPrefix("the-scarlet-oa..", twoOaths)).toBeNull();
    expect(resolveSlugByPrefix("the-scarlet-oath-", twoOaths)).toBe(
      "the-scarlet-oath-season-2",
    );
  });

  it(`a prefix shorter than ${SLUG_PREFIX_MIN_LENGTH} → null; exactly ${SLUG_PREFIX_MIN_LENGTH} is eligible`, () => {
    expect(SLUG_PREFIX_MIN_LENGTH).toBe(6);
    // 5 chars — even though only one show starts with it.
    expect(resolveSlugByPrefix("queda", CATALOG)).toBeNull();
    expect(resolveSlugByPrefix("the-s", CATALOG)).toBeNull();
    expect(resolveSlugByPrefix("the-s..", CATALOG)).toBeNull();
    // 4 chars that two shows share — short AND ambiguous, null either way.
    expect(resolveSlugByPrefix("the-", CATALOG)).toBeNull();
    // 6 chars (`the-sc`) IS long enough — the boundary is the constant above,
    // not the issue's `the-sc → 404` example, which counts it as five.
    expect(resolveSlugByPrefix("the-sc", CATALOG)).toBe("the-scarlet-oath");
    expect(resolveSlugByPrefix("the-he", CATALOG)).toBe("the-heather-oath-two-blades");
    // The dots do not count towards the length: `the-s..` is five.
    expect(resolveSlugByPrefix("the-s…", CATALOG)).toBeNull();
  });

  it("an exact slug → null: that is the page's own render, never a 308 onto itself", () => {
    expect(resolveSlugByPrefix("the-scarlet-oath", CATALOG)).toBeNull();
    expect(resolveSlugByPrefix("fallen", CATALOG)).toBeNull();
    // …even when the slug is also a prefix of another one.
    expect(
      resolveSlugByPrefix("the-scarlet-oath", [...CATALOG, "the-scarlet-oath-season-2"]),
    ).toBeNull();
  });

  it("a full slug with trailing dots is a different URL (a 404 today) — it redirects", () => {
    expect(resolveSlugByPrefix("the-scarlet-oath..", CATALOG)).toBe("the-scarlet-oath");
    expect(resolveSlugByPrefix("The-Scarlet-Oath", CATALOG)).toBe("the-scarlet-oath");
  });

  it("the result is never the input — no redirect loop is possible", () => {
    for (const raw of [...CATALOG, "the-scarlet-oa..", "the-", "x", ""]) {
      expect(resolveSlugByPrefix(raw, CATALOG)).not.toBe(raw);
    }
  });
});

describe("withSearchParams — the 308 carries the original query over", () => {
  it("no query → the bare path, no trailing `?`", () => {
    expect(withSearchParams("/shows/the-scarlet-oath", {})).toBe(
      "/shows/the-scarlet-oath",
    );
  });

  it("keeps utm_* / fbclid as they came", () => {
    expect(
      withSearchParams("/shows/the-scarlet-oath", {
        utm_source: "youtube",
        fbclid: "IwAR0abc",
      }),
    ).toBe("/shows/the-scarlet-oath?utm_source=youtube&fbclid=IwAR0abc");
  });

  it("a repeated key (Next hands it over as an array) is repeated; undefined is dropped", () => {
    expect(
      withSearchParams("/watch/the-scarlet-oath", {
        ep: ["a", "b"],
        resume: undefined,
        cs: "cs_test_123",
      }),
    ).toBe("/watch/the-scarlet-oath?ep=a&ep=b&cs=cs_test_123");
  });

  it("values are re-encoded, so a crafted value cannot break out of the query", () => {
    expect(
      withSearchParams("/shows/the-scarlet-oath", { q: "a b&c=d#e" }),
    ).toBe("/shows/the-scarlet-oath?q=a+b%26c%3Dd%23e");
  });
});
