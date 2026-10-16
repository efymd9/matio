import { describe, expect, it } from "vitest";

import { JOB_POSITIONS, VACANCIES, VACANCY_LIST, isJobPosition } from "./careers";
import {
  JOB_APPLICATION_RATELIMIT_PER_HOUR,
  JOB_APPLICATION_RETENTION_MONTHS,
  JOB_LIMITS,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_LABELS,
  firstNameOf,
  isHttpLink,
  isSocialHandle,
  jobTextLength,
  normalizeJobApplication,
  portfolioRequiredFor,
  validateJobApplication,
  type JobApplicationInput,
} from "./job-application";

// The /careers form rules (#376) — the one module both the client form and
// submitJobApplication validate with. What is pinned: the spec's limits, the
// link rule (http/https only — the admin panel makes a stored link clickable
// on that promise), the portfolio rule per role, the 0–4 profiles, and the
// order the errors come in (the form focuses the first).

function valid(over: Partial<JobApplicationInput> = {}): JobApplicationInput {
  return {
    position: "ai-creator",
    fullName: "Ana Rivera",
    email: "Ana@Example.com",
    location: "Madrid, Spain",
    linkedinUrl: "",
    portfolioUrl: "https://vimeo.com/ana",
    socials: [],
    message: "I make dark short films with generative tools.",
    ageConfirmed: true,
    website: "",
    ...over,
  };
}

describe("the roles (lib/careers.ts)", () => {
  it("are exactly the two the owner named, in page order, each keyed by its own id", () => {
    expect(JOB_POSITIONS).toEqual(["ai-creator", "sales-distribution"]);
    expect(VACANCY_LIST.map((v) => v.title)).toEqual([
      "AI Creator",
      "Sales & Distribution Manager",
    ]);
    for (const id of JOB_POSITIONS) expect(VACANCIES[id].id).toBe(id);
  });

  it("carry no invented facts: location and employment type are null until the owner gives them, and no placeholder brackets anywhere", () => {
    for (const v of VACANCY_LIST) {
      expect(v.location).toBeNull();
      expect(v.employmentType).toBeNull();
      expect(v.whatYoullDo.length).toBeGreaterThan(0);
      expect(v.whatWereLookingFor.length).toBeGreaterThan(0);
      expect(JSON.stringify(v)).not.toMatch(/\[[A-Z /]+\]/);
      expect(JSON.stringify(v)).not.toMatch(/\$|salary|€|£/i);
    }
  });

  it("isJobPosition accepts the ids and nothing else — an array from `?role=a&role=b` included", () => {
    expect(isJobPosition("ai-creator")).toBe(true);
    expect(isJobPosition("sales-distribution")).toBe(true);
    for (const bad of ["", "AI-CREATOR", "screenwriter", ["ai-creator"], undefined, null, 3]) {
      expect(isJobPosition(bad)).toBe(false);
    }
  });
});

describe("constants", () => {
  it("match the spec: 5 applications an hour per IP, 6 months of retention, the field limits", () => {
    expect(JOB_APPLICATION_RATELIMIT_PER_HOUR).toBe(5);
    expect(JOB_APPLICATION_RETENTION_MONTHS).toBe(6);
    expect(JOB_LIMITS).toEqual({
      fullName: 100,
      email: 254,
      location: 100,
      link: 300,
      message: 2000,
      socials: 4,
    });
    expect(SOCIAL_PLATFORMS).toEqual(["tiktok", "instagram", "youtube", "x", "other"]);
    expect(SOCIAL_PLATFORMS.map((p) => SOCIAL_PLATFORM_LABELS[p])).toEqual([
      "TikTok",
      "Instagram",
      "YouTube",
      "X",
      "Other",
    ]);
  });
});

describe("isHttpLink", () => {
  it("takes a full http(s) link with a dotted host", () => {
    for (const ok of [
      "https://www.linkedin.com/in/ana-rivera",
      "http://ana.example.com",
      "HTTPS://Vimeo.com/123?x=1#t=2",
    ]) {
      expect(isHttpLink(ok), ok).toBe(true);
    }
  });

  it("refuses every other scheme, a bare domain, a relative path, whitespace, a host without a dot and anything over 300", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JavaScript://example.com/%0Aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com/reel",
      "linkedin.com/in/ana",
      "//evil.example.com",
      "/careers",
      "https://exa mple.com",
      "https://localhost",
      "https://",
      `https://example.com/${"a".repeat(290)}`,
      "",
    ]) {
      expect(isHttpLink(bad), bad).toBe(false);
    }
  });
});

describe("isSocialHandle", () => {
  it("is an @ and 1–60 of letters, digits, dot, underscore, dash", () => {
    expect(isSocialHandle("@ana.rivera_92-x")).toBe(true);
    expect(isSocialHandle(`@${"a".repeat(60)}`)).toBe(true);
    for (const bad of ["ana", "@", "@ana rivera", "@ana/x", `@${"a".repeat(61)}`, "@<script>"]) {
      expect(isSocialHandle(bad), bad).toBe(false);
    }
  });
});

describe("normalizeJobApplication", () => {
  it("trims every text, lowercases the address, folds CRLF, drops NUL, and a non-boolean tick is false", () => {
    const v = normalizeJobApplication({
      ...valid(),
      fullName: "  Ana Rivera\u0000 ",
      email: "  Ana@Example.COM ",
      message: "Line one\r\nLine two\rLine three",
      ageConfirmed: "yes",
    });
    expect(v.fullName).toBe("Ana Rivera");
    expect(v.email).toBe("ana@example.com");
    // A forged NUL in the address goes too — Postgres text refuses it.
    expect(normalizeJobApplication({ email: " Ana\u0000@Example.com " }).email).toBe(
      "ana@example.com",
    );
    expect(v.message).toBe("Line one\nLine two\nLine three");
    expect(v.ageConfirmed).toBe(false);
  });

  it("drops social rows left blank and keeps the filled ones in order", () => {
    const v = normalizeJobApplication(
      valid({
        socials: [
          { platform: "tiktok", value: "  " },
          { platform: "youtube", value: " https://youtube.com/@ana " },
          { platform: "x", value: "" },
          { platform: "instagram", value: "@ana" },
        ],
      }),
    );
    expect(v.socials).toEqual([
      { platform: "youtube", value: "https://youtube.com/@ana" },
      { platform: "instagram", value: "@ana" },
    ]);
  });

  it("reads a forged request — not an object, a socials that is not an array, rows that are not objects — as empty", () => {
    expect(normalizeJobApplication(null)).toMatchObject({ position: "", fullName: "", socials: [] });
    expect(normalizeJobApplication({ socials: "@ana" }).socials).toEqual([]);
    expect(normalizeJobApplication({ socials: [null, 3, { value: "@ana" }] }).socials).toEqual([
      { platform: "", value: "@ana" },
    ]);
  });

  it("counts code points: an emoji is one character", () => {
    expect(jobTextLength("🎬🎬")).toBe(2);
    expect(jobTextLength(" a\r\nb ")).toBe(3);
    expect(jobTextLength(42)).toBe(0);
  });
});

describe("validateJobApplication", () => {
  it("a complete application is valid", () => {
    expect(validateJobApplication(valid())).toEqual([]);
  });

  it("an empty send reports every required field, in submit order — the portfolio too once AI Creator is picked", () => {
    expect(
      validateJobApplication({
        position: "ai-creator",
        fullName: "",
        email: "",
        location: "",
        linkedinUrl: "",
        portfolioUrl: "",
        socials: [],
        message: "",
        ageConfirmed: false,
        website: "",
      }),
    ).toEqual([
      { field: "fullName", code: "name_required" },
      { field: "email", code: "email_required" },
      { field: "location", code: "location_required" },
      { field: "portfolio", code: "portfolio_required" },
      { field: "message", code: "message_required" },
      { field: "age", code: "age_required" },
    ]);
  });

  it("no role picked is position_required — and the portfolio is not asked for before a role says so", () => {
    expect(validateJobApplication(valid({ position: "", portfolioUrl: "" }))).toEqual([
      { field: "position", code: "position_required" },
    ]);
    expect(validateJobApplication(valid({ position: "screenwriter" }))).toEqual([
      { field: "position", code: "position_required" },
    ]);
  });

  it("AI Creator without a portfolio is refused; Sales & Distribution without one passes", () => {
    expect(portfolioRequiredFor("ai-creator")).toBe(true);
    expect(portfolioRequiredFor("sales-distribution")).toBe(false);
    expect(portfolioRequiredFor("")).toBe(false);
    expect(validateJobApplication(valid({ portfolioUrl: "" }))).toEqual([
      { field: "portfolio", code: "portfolio_required" },
    ]);
    expect(
      validateJobApplication(valid({ position: "sales-distribution", portfolioUrl: "" })),
    ).toEqual([]);
  });

  it("a javascript: link is refused wherever a link goes — LinkedIn, portfolio, a profile", () => {
    expect(
      validateJobApplication(
        valid({
          linkedinUrl: "javascript:alert(1)",
          portfolioUrl: "javascript:alert(1)",
          socials: [{ platform: "other", value: "javascript:alert(1)" }],
        }),
      ),
    ).toEqual([
      { field: "linkedin", code: "linkedin_invalid" },
      { field: "portfolio", code: "portfolio_invalid" },
      { field: "socials", code: "social_invalid", index: 0 },
    ]);
  });

  it("takes up to four profiles — handles and links — and refuses a fifth", () => {
    const four = [
      { platform: "tiktok", value: "@ana" },
      { platform: "instagram", value: "https://instagram.com/ana" },
      { platform: "youtube", value: "@ana.films" },
      { platform: "x", value: "https://x.com/ana" },
    ];
    expect(validateJobApplication(valid({ socials: four }))).toEqual([]);
    expect(
      validateJobApplication(
        valid({ socials: [...four, { platform: "other", value: "@ana5" }] }),
      ),
    ).toEqual([{ field: "socials", code: "socials_too_many" }]);
  });

  it("names a bad profile by its place among the FILLED rows, and refuses an unknown platform", () => {
    expect(
      validateJobApplication(
        valid({
          socials: [
            { platform: "tiktok", value: "" },
            { platform: "tiktok", value: "@fine" },
            { platform: "youtube", value: "not a handle" },
            { platform: "myspace", value: "@fine" },
          ],
        }),
      ),
    ).toEqual([
      { field: "socials", code: "social_invalid", index: 1 },
      { field: "socials", code: "social_invalid", index: 2 },
    ]);
  });

  it("enforces the length caps in code points", () => {
    expect(
      validateJobApplication(
        valid({
          fullName: "a".repeat(101),
          location: "b".repeat(101),
          message: "🎬".repeat(2001),
        }),
      ),
    ).toEqual([
      { field: "fullName", code: "name_too_long" },
      { field: "location", code: "location_too_long" },
      { field: "message", code: "message_too_long" },
    ]);
    // 2,000 emoji are 4,000 UTF-16 units but exactly at the cap.
    expect(validateJobApplication(valid({ message: "🎬".repeat(2000) }))).toEqual([]);
  });

  it("an empty address is email_required, not email_invalid — its own message", () => {
    expect(validateJobApplication(valid({ email: "   " }))).toEqual([
      { field: "email", code: "email_required" },
    ]);
  });

  it("refuses an address that is malformed or too long", () => {
    for (const email of ["ana", "ana@example", "ana @example.com", `${"a".repeat(250)}@x.com`]) {
      expect(validateJobApplication(valid({ email })), email).toEqual([
        { field: "email", code: "email_invalid" },
      ]);
    }
  });
});

describe("firstNameOf", () => {
  it("is the first word of the name, for the success card's greeting", () => {
    expect(firstNameOf("  Ana   María Rivera ")).toBe("Ana");
    expect(firstNameOf("Prince")).toBe("Prince");
    expect(firstNameOf("")).toBe("");
  });
});
