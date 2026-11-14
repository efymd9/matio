import { describe, expect, it } from "vitest";
import {
  ENQUIRY_LIMITS,
  normalizeScreenerRequest,
  normalizeStudioBrief,
  textLength,
  validateScreenerRequest,
  validateStudioBrief,
} from "./b2b-enquiry";

// The rules shared by the /studio and /licensing forms and their actions (#498).

const brief = (over = {}) =>
  normalizeStudioBrief({
    name: "Ana Rivera",
    email: "ana@studio.example",
    projectType: "vfx",
    brief: "Twelve shots of set extension.",
    timeline: "",
    budget: "",
    website: "",
    ...over,
  });

const screener = (over = {}) =>
  normalizeScreenerRequest({
    title: "",
    name: "Ana Rivera",
    company: "Northern Screens",
    email: "ana@northern.example",
    market: "Nordics",
    website: "",
    ...over,
  });

describe("normalize", () => {
  it("trims, lowercases the address, folds single-line newlines and drops control characters", () => {
    const v = normalizeStudioBrief({
      name: "  Ana \n Rivera\u0007 ",
      email: " Ana@Studio.EXAMPLE ",
      brief: "  line one  \r\n\r\n\r\n\r\nline   two ",
    });
    expect(v.name).toBe("Ana Rivera");
    expect(v.email).toBe("ana@studio.example");
    // A brief keeps its paragraphs, at most one blank line between them.
    expect(v.brief).toBe("line one\n\nline two");
    // Missing / non-string fields become "".
    expect(v.timeline).toBe("");
    expect(normalizeScreenerRequest({ name: 42 as unknown as string }).name).toBe("");
  });

  it("counts code points, not UTF-16 units", () => {
    expect(textLength("🎬🎬")).toBe(2);
  });
});

describe("validateStudioBrief", () => {
  it("accepts a complete brief, with or without the optional timeline and budget", () => {
    expect(validateStudioBrief(brief())).toEqual([]);
    expect(validateStudioBrief(brief({ timeline: "Q3", budget: "25k-100k" }))).toEqual([]);
  });

  it("reports every empty required field, in the order the form shows them", () => {
    expect(validateStudioBrief(normalizeStudioBrief({}))).toEqual([
      { field: "name", code: "required" },
      { field: "email", code: "required" },
      { field: "projectType", code: "required" },
      { field: "brief", code: "required" },
    ]);
  });

  it("refuses a bad address, an unknown project type or budget and an over-long brief", () => {
    expect(
      validateStudioBrief(
        brief({
          email: "ana at studio",
          projectType: "music-video",
          brief: "x".repeat(ENQUIRY_LIMITS.brief + 1),
          budget: "a-million",
        }),
      ),
    ).toEqual([
      { field: "email", code: "invalid_email" },
      { field: "projectType", code: "invalid_choice" },
      { field: "brief", code: "too_long" },
      { field: "budget", code: "invalid_choice" },
    ]);
    expect(validateStudioBrief(brief({ email: `${"a".repeat(250)}@x.io` }))).toEqual([
      { field: "email", code: "too_long" },
    ]);
  });
});

describe("validateScreenerRequest", () => {
  const SLUGS = ["the-scarlet-oath"];

  it("accepts a title on offer or none at all (a catalogue enquiry)", () => {
    expect(validateScreenerRequest(screener({ title: "the-scarlet-oath" }), SLUGS)).toEqual([]);
    expect(validateScreenerRequest(screener(), SLUGS)).toEqual([]);
  });

  it("refuses a title that is not on the licensing list", () => {
    expect(validateScreenerRequest(screener({ title: "fallen" }), SLUGS)).toEqual([
      { field: "title", code: "invalid_choice" },
    ]);
  });

  it("requires the name, the company, the work email and the market", () => {
    expect(validateScreenerRequest(normalizeScreenerRequest({}), SLUGS)).toEqual([
      { field: "name", code: "required" },
      { field: "company", code: "required" },
      { field: "email", code: "required" },
      { field: "market", code: "required" },
    ]);
  });
});
