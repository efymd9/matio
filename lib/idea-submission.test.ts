import { describe, expect, it } from "vitest";

import {
  IDEA_LIMITS,
  NEW_SERIES_VALUE,
  ideaTextLength,
  normalizeIdeaInput,
  normalizeIdeaText,
  validateIdeaInput,
  type IdeaSubmissionInput,
} from "./idea-submission";

// The /ideas form's rules (#297). The client form and the server action both
// run them, so what is pinned here is what a fan can and cannot send: every
// cap exactly at its edge, the order errors are reported in, and the one
// length measure (code points after normalisation) that must agree with
// Postgres char_length.

function valid(overrides: Partial<IdeaSubmissionInput> = {}): IdeaSubmissionInput {
  return {
    series: "the-scarlet-oath",
    workingTitle: "The Last Letter",
    logline: "What if a postman had one last letter to deliver?",
    story: "It begins at dawn.",
    name: "Ana",
    email: "ana@example.com",
    ageConfirmed: true,
    termsAccepted: true,
    marketingOptIn: false,
    website: "",
    ...overrides,
  };
}

const codes = (input: IdeaSubmissionInput) =>
  validateIdeaInput(input).map((e) => e.code);

describe("validateIdeaInput — a complete pitch", () => {
  it("passes with no errors, for a series and for a brand-new one", () => {
    expect(validateIdeaInput(valid())).toEqual([]);
    expect(validateIdeaInput(valid({ series: NEW_SERIES_VALUE }))).toEqual([]);
  });

  it("needs no working title and no marketing tick", () => {
    expect(
      validateIdeaInput(valid({ workingTitle: "", marketingOptIn: false })),
    ).toEqual([]);
  });
});

describe("validateIdeaInput — every cap at its edge", () => {
  it("logline: 300 passes, 301 is logline_too_long, empty is logline_required", () => {
    expect(codes(valid({ logline: "a".repeat(IDEA_LIMITS.logline) }))).toEqual([]);
    expect(codes(valid({ logline: "a".repeat(301) }))).toEqual(["logline_too_long"]);
    expect(codes(valid({ logline: "   " }))).toEqual(["logline_required"]);
  });

  it("story: 10,000 passes, 10,001 is story_too_long, empty is story_required", () => {
    expect(codes(valid({ story: "s".repeat(10_000) }))).toEqual([]);
    expect(codes(valid({ story: "s".repeat(10_001) }))).toEqual(["story_too_long"]);
    expect(codes(valid({ story: "\r\n \n" }))).toEqual(["story_required"]);
  });

  it("working title: 100 passes, 101 is title_too_long", () => {
    expect(codes(valid({ workingTitle: "t".repeat(100) }))).toEqual([]);
    expect(codes(valid({ workingTitle: "t".repeat(101) }))).toEqual(["title_too_long"]);
  });

  it("name: 80 passes, 81 is name_too_long, empty is name_required", () => {
    expect(codes(valid({ name: "n".repeat(80) }))).toEqual([]);
    expect(codes(valid({ name: "n".repeat(81) }))).toEqual(["name_too_long"]);
    expect(codes(valid({ name: "" }))).toEqual(["name_required"]);
  });

  it("series: empty is series_required (whether it exists is the server's question)", () => {
    expect(codes(valid({ series: "" }))).toEqual(["series_required"]);
    expect(codes(valid({ series: "no-such-show" }))).toEqual([]);
  });

  it("email: malformed or over 254 is email_invalid", () => {
    for (const email of ["", "ana", "ana@", "ana@example", "a na@example.com", "@example.com"]) {
      expect(codes(valid({ email }))).toEqual(["email_invalid"]);
    }
    const local = "a".repeat(64);
    const at254 = `${local}@${"d".repeat(254 - local.length - 1 - 4)}.com`;
    expect(at254).toHaveLength(254);
    expect(codes(valid({ email: at254 }))).toEqual([]);
    expect(codes(valid({ email: `a${at254}` }))).toEqual(["email_invalid"]);
  });

  it("the 18+ and terms ticks are both required", () => {
    expect(codes(valid({ ageConfirmed: false }))).toEqual(["age_required"]);
    expect(codes(valid({ termsAccepted: false }))).toEqual(["terms_required"]);
  });
});

describe("validateIdeaInput — errors come back in submit order", () => {
  it("logline → series → workingTitle → story → name → email → age → terms", () => {
    const errors = validateIdeaInput({
      series: "",
      workingTitle: "t".repeat(101),
      logline: "",
      story: "",
      name: "",
      email: "nope",
      ageConfirmed: false,
      termsAccepted: false,
      marketingOptIn: false,
      website: "",
    });
    expect(errors).toEqual([
      { field: "logline", code: "logline_required" },
      { field: "series", code: "series_required" },
      { field: "workingTitle", code: "title_too_long" },
      { field: "story", code: "story_required" },
      { field: "name", code: "name_required" },
      { field: "email", code: "email_invalid" },
      { field: "age", code: "age_required" },
      { field: "terms", code: "terms_required" },
    ]);
  });
});

describe("the length measure", () => {
  it("CRLF does not count twice: a 10,000-character story typed with CRLF fits", () => {
    // 5,000 "x" lines joined by CRLF plus a final "y": 5,000 + 4,999 LF + 1
    // = 10,000 after normalisation, 14,999 UTF-16 units before it.
    const lines = Array.from({ length: 5_000 }, () => "x");
    const crlf = lines.join("\r\n") + "y";
    expect(crlf.length).toBeGreaterThan(IDEA_LIMITS.story);
    expect(ideaTextLength(crlf)).toBe(10_000);
    expect(codes(valid({ story: crlf }))).toEqual([]);
  });

  it("a lone CR is a line break too", () => {
    expect(normalizeIdeaText("a\rb\r\nc")).toBe("a\nb\nc");
  });

  it("NUL is cut out (Postgres text refuses it) and does not count", () => {
    expect(normalizeIdeaText("a\u0000b")).toBe("ab");
    expect(ideaTextLength("\u0000".repeat(5) + "abc")).toBe(3);
  });

  it("an emoji is one code point, as in Postgres char_length", () => {
    expect("😀".length).toBe(2);
    expect(ideaTextLength("😀")).toBe(1);
    const atCap = "😀".repeat(IDEA_LIMITS.logline);
    expect(codes(valid({ logline: atCap }))).toEqual([]);
    expect(codes(valid({ logline: atCap + "😀" }))).toEqual(["logline_too_long"]);
  });

  it("the ends are trimmed before counting", () => {
    expect(ideaTextLength("  \n abc \n ")).toBe(3);
  });
});

describe("normalizeIdeaInput", () => {
  it("trims and lowercases the address", () => {
    expect(normalizeIdeaInput(valid({ email: "  Ana.Pérez@Example.COM " })).email).toBe(
      "ana.pérez@example.com",
    );
    expect(codes(valid({ email: " Ana@Example.COM " }))).toEqual([]);
  });

  it("forged types read as empty text and unticked boxes", () => {
    const forged = {
      series: 42,
      workingTitle: ["x"],
      logline: { toString: () => "What if…" },
      story: null,
      name: undefined,
      email: 7,
      ageConfirmed: "true",
      termsAccepted: 1,
      marketingOptIn: "yes",
      website: false,
    } as unknown as IdeaSubmissionInput;
    expect(normalizeIdeaInput(forged)).toEqual({
      series: "",
      workingTitle: "",
      logline: "",
      story: "",
      name: "",
      email: "",
      ageConfirmed: false,
      termsAccepted: false,
      marketingOptIn: false,
      website: "",
    });
    expect(codes(forged)).toEqual([
      "logline_required",
      "series_required",
      "story_required",
      "name_required",
      "email_invalid",
      "age_required",
      "terms_required",
    ]);
  });

  it("a request with no object at all is an empty form, not a throw", () => {
    for (const input of [null, undefined, "x", 3]) {
      expect(() =>
        validateIdeaInput(input as unknown as IdeaSubmissionInput),
      ).not.toThrow();
      expect(normalizeIdeaInput(input).logline).toBe("");
    }
  });
});
