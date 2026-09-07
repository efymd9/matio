import { describe, expect, it } from "vitest";

import { en, ru } from "./admin-dictionaries";

// The admin panel has no locale negotiation: a key missing from one of the
// two blocks is a hole the owner hits on the next RU|EN toggle. `en: AdminDict`
// already pins the KEYS at compile time; what it cannot pin is that a
// template still interpolates its argument, or that a value was pasted
// rather than translated. The branching section (#143) is the newest and
// the most template-heavy, so it gets the full sweep.

type Leaf = string | ((...args: never[]) => string);

function leaves(dict: object, prefix = ""): Array<[string, Leaf]> {
  return Object.entries(dict).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) return leaves(value, path);
    return [[path, value as Leaf]];
  });
}

describe("admin dictionaries — fork section", () => {
  it("interpolates its arguments in both locales", () => {
    for (const t of [ru, en]) {
      expect(t.fork.branchOfHint(900)).toContain("900");
      expect(t.fork.windowHint(3, 30)).toMatch(/3.*30/);
      expect(t.fork.choiceN(2)).toContain("2");
      expect(t.fork.previewTimer(12)).toContain("12");
      expect(t.fork.previewAuto("E3 · Third")).toContain("E3 · Third");
      expect(t.fork.branchOfBadge(3)).toContain("E3");
    }
  });

  it("is translated, not pasted, between RU and EN", () => {
    const enLeaves = new Map(leaves(en.fork));
    for (const [path, value] of leaves(ru.fork)) {
      const counterpart = enLeaves.get(path);
      expect(counterpart, path).toBeDefined();
      if (typeof value === "string") {
        expect(value.trim().length, path).toBeGreaterThan(0);
        // The two prompt placeholders are the viewer-facing EN/ES examples
        // and are identical by design; everything else must differ.
        if (!path.startsWith("promptPlaceholder")) {
          expect(counterpart, path).not.toBe(value);
        }
      }
    }
  });

  it("carries copy for every typed fork and publish-guard code", () => {
    const codes = [
      "forkWindowOutOfRange",
      "branchParentInvalid",
      "tooManyChoices",
      "choiceTargetRequired",
      "choiceTargetInvalid",
      "choiceTargetNotReady",
      "duplicateChoiceTarget",
      "forkNeedsTwoChoices",
      "forkPromptRequired",
      "choiceLabelRequired",
      "choiceTargetNotBranch",
      "publishForkIncomplete",
      "publishBranchNotReady",
      "publishChoiceTargetNotBranch",
      "publishBranchCycle",
    ] as const;
    for (const code of codes) {
      expect(ru.formErrors[code].length).toBeGreaterThan(0);
      expect(en.formErrors[code].length).toBeGreaterThan(0);
      expect(en.formErrors[code]).not.toBe(ru.formErrors[code]);
    }
  });
});
