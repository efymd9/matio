import { describe, expect, it } from "vitest";

import { appDictFor, appEn, appEs } from "./app-dictionaries";

// The app-only copy. The web dictionaries are typed against each other
// (`en: Dict`), which already guarantees the same KEYS — what it cannot
// guarantee is that a value was actually translated rather than pasted, or
// that a template still interpolates. Both are the kind of drift a store
// build ships silently.

type Leaf = string | ((...args: never[]) => string);

function leaves(dict: object, prefix = ""): Array<[string, Leaf]> {
  return Object.entries(dict).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) return leaves(value, path);
    return [[path, value as Leaf]];
  });
}

describe("app dictionaries", () => {
  it("resolves the locale to its own dictionary", () => {
    expect(appDictFor("es")).toBe(appEs);
    expect(appDictFor("en")).toBe(appEn);
  });

  it("has every leaf translated, not pasted between locales", () => {
    const es = new Map(leaves(appEs));
    for (const [path, en] of leaves(appEn)) {
      const esValue = es.get(path);
      expect(esValue, path).toBeDefined();
      if (typeof en === "string") {
        // A brand name alone ("Matio") is the same in both; every other
        // leaf here carries a sentence, so identical text means untranslated.
        expect(esValue, path).not.toBe(en);
        expect(en.trim().length, path).toBeGreaterThan(0);
      }
    }
  });

  it("interpolates the address into the code-sent line in both locales", () => {
    expect(appEs.signIn.codeSent("a@example.invalid")).toContain("a@example.invalid");
    expect(appEn.signIn.codeSent("a@example.invalid")).toBe(
      "We sent a code to a@example.invalid.",
    );
  });
});
