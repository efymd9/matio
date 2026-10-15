import { describe, expect, it } from "vitest";

import { VACANCY_LIST } from "../careers";
import { JOB_APPLICATION_RETENTION_MONTHS } from "../job-application";
import { countWord, en, joinWithAnd } from "./careers-dictionaries";

// The /careers copy (#376) names and counts the roles in five places — the
// meta description, the hero's role line, the section title, the phone bar
// and the FAQ answer. None of them is typed by hand: each is built from
// lib/careers.ts:VACANCY_LIST, so a role changes in one place. This suite pins
// that every one of them follows the list, and that the two lines promising
// what the details are used for also say what the analytics sees.

describe("the roles in the copy follow VACANCY_LIST", () => {
  const titles = VACANCY_LIST.map((v) => v.title);

  it("the meta description and the FAQ name every role by its title", () => {
    for (const title of titles) {
      expect(en.meta.description).toContain(title);
      expect(en.faq.roles.a).toContain(title);
    }
    expect(en.faq.roles.a).toBe(
      `${countWord(VACANCY_LIST.length)}: ${joinWithAnd(titles)}. Pick one at the top of the form.`,
    );
  });

  it("the hero's role line is the short titles, in page order", () => {
    expect(en.hero.roles).toBe(VACANCY_LIST.map((v) => v.shortTitle).join(" · "));
    expect(en.hero.roles).toBe("AI Creator · Sales & Distribution");
  });

  it("the section title and the phone bar count the roles", () => {
    expect(VACANCY_LIST).toHaveLength(2);
    expect(en.roles.title[0]).toBe("Two roles.");
    expect(en.bar.sub).toBe("Two open roles · about 5 minutes");
  });
});

describe("helpers", () => {
  it("joinWithAnd: nothing, one, two, three", () => {
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["A"])).toBe("A");
    expect(joinWithAnd(["A", "B"])).toBe("A and B");
    expect(joinWithAnd(["A", "B", "C"])).toBe("A, B and C");
  });

  it("countWord: a word up to ten, digits after", () => {
    expect(countWord(0)).toBe("No");
    expect(countWord(1)).toBe("One");
    expect(countWord(2)).toBe("Two");
    expect(countWord(10)).toBe("Ten");
    expect(countWord(11)).toBe("11");
  });
});

describe("what the details are used for", () => {
  it("the form's privacy line and the FAQ give the retention constant and own up to the analytics count", () => {
    for (const line of [en.form.privacy.before, en.faq.data.a.before]) {
      expect(line).toContain("only to consider you for work at Matio");
      expect(line).toContain(`${JOB_APPLICATION_RETENTION_MONTHS} months`);
      expect(line).toContain("our analytics also counts that an application for a role was sent");
      expect(line).toContain("never what's in it");
    }
  });
});
