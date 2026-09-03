import { describe, expect, it } from "vitest";

import { isValidSlug, slugify, SLUG_PATTERN } from "./slug";

// One charset rule shared by the admin form's `pattern` attribute and the
// server action's validation — these tests pin the two sides together.

describe("isValidSlug", () => {
  it("accepts exactly the charset the <input pattern> advertises", () => {
    expect(isValidSlug("the-scarlet-oath")).toBe(true);
    expect(isValidSlug("show-2")).toBe(true);
    expect(isValidSlug("Scarlet")).toBe(false);
    expect(isValidSlug("scarlet oath")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    // The exported pattern is what the form uses — keep them in lockstep.
    expect(new RegExp(`^${SLUG_PATTERN}$`).test("the-scarlet-oath")).toBe(true);
  });
});

describe("slugify", () => {
  it("transliterates Cyrillic titles into usable slugs", () => {
    // The admin panel is staffed by Russian speakers; a Cyrillic title must
    // not collapse into an empty suggestion.
    expect(slugify("Алая клятва")).toBe("alaya-klyatva");
    expect(slugify("Ёжик в тумане")).toBe("ezhik-v-tumane");
  });

  it("folds Latin diacritics and collapses separators", () => {
    expect(slugify("QUÉDATE conmigo")).toBe("quedate-conmigo");
    expect(slugify("  A   Marriage — Proposal!  ")).toBe("a-marriage-proposal");
  });

  it("returns an empty string for untransliterable input — callers treat it as no suggestion", () => {
    expect(slugify("猫の物語")).toBe("");
    expect(isValidSlug(slugify("猫の物語"))).toBe(false);
  });

  it("always produces either a valid slug or an empty string", () => {
    for (const title of ["Алая клятва", "QUÉDATE", "a b c", "-x-", "猫"]) {
      const out = slugify(title);
      expect(out === "" || isValidSlug(out)).toBe(true);
    }
  });
});
