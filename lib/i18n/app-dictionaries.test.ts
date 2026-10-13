import { describe, expect, it } from "vitest";

import { appEn } from "./app-dictionaries";

// The app-only copy. English only since #447: the translation checks that
// used to pair it with a Spanish twin went with the twin; what a store build
// can still ship silently is an empty leaf or a template that no longer
// interpolates.

type Leaf = string | ((...args: never[]) => string);

function leaves(dict: object, prefix = ""): Array<[string, Leaf]> {
  return Object.entries(dict).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) return leaves(value, path);
    return [[path, value as Leaf]];
  });
}

describe("app dictionary", () => {
  it("has no empty leaf", () => {
    for (const [path, value] of leaves(appEn)) {
      if (typeof value === "string") expect(value.trim().length, path).toBeGreaterThan(0);
      else expect(value, path).toBeTypeOf("function");
    }
  });

  it("interpolates the address into the code-sent line", () => {
    expect(appEn.signIn.codeSent("a@example.invalid")).toBe(
      "We sent a code to a@example.invalid.",
    );
  });

  it("is one dictionary, with no copy left for a language switcher", async () => {
    const mod: Record<string, unknown> = await import("./app-dictionaries");
    expect(Object.keys(mod).sort()).toEqual(["appEn"]);
    expect(appEn.settings).not.toHaveProperty("langHint");
  });
});
