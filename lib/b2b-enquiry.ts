// The two business enquiry forms (#498): the production / VFX brief on
// /studio and the screener request on /licensing. Universal + PURE — the
// client forms and the server actions run the SAME rules, so a code the form
// shows can never drift from the one the server answers.
//
// Nothing here is stored: an accepted enquiry becomes ONE email to the
// studio mailbox (lib/b2b-enquiry-email.ts). So the limits are about a
// readable email and a bounded Resend payload, not about columns.

export const ENQUIRY_LIMITS = {
  name: 120,
  email: 254,
  company: 160,
  market: 160,
  timeline: 120,
  brief: 3000,
} as const;

// Per hashed client IP bucket per hour, the /careers brake's number.
export const ENQUIRY_RATELIMIT_PER_HOUR = 5;

// The three blocks of /studio, plus a way out. The ids travel in the action
// input; the labels are what the studio reads in the email subject.
export const STUDIO_PROJECT_TYPES = [
  { id: "series", label: "Scripted series or pilot" },
  { id: "live-action-ai", label: "Live action + AI" },
  { id: "vfx", label: "VFX for existing footage" },
  { id: "other", label: "Something else" },
] as const;
export type StudioProjectType = (typeof STUDIO_PROJECT_TYPES)[number]["id"];

// Optional. "" = not given.
export const BUDGET_RANGES = [
  { id: "under-25k", label: "Under $25k" },
  { id: "25k-100k", label: "$25k – $100k" },
  { id: "100k-500k", label: "$100k – $500k" },
  { id: "over-500k", label: "Over $500k" },
  { id: "not-sure", label: "Not sure yet" },
] as const;
export type BudgetRange = (typeof BUDGET_RANGES)[number]["id"];

export function projectTypeLabel(id: string): string | null {
  return STUDIO_PROJECT_TYPES.find((p) => p.id === id)?.label ?? null;
}
export function budgetLabel(id: string): string | null {
  return BUDGET_RANGES.find((b) => b.id === id)?.label ?? null;
}

// `website` is the honeypot in both forms: off screen, never filled by a
// person. The server swallows a filled one with a success.
export type StudioBriefInput = {
  name: string;
  email: string;
  projectType: string;
  brief: string;
  timeline: string;
  budget: string;
  website: string;
};

export type ScreenerRequestInput = {
  // A slug from lib/licensing.ts, or "" — "the catalogue in general".
  title: string;
  name: string;
  company: string;
  email: string;
  market: string;
  website: string;
};

export type EnquiryField =
  | "name"
  | "email"
  | "company"
  | "market"
  | "projectType"
  | "brief"
  | "timeline"
  | "budget"
  | "title";

export type EnquiryErrorCode = "required" | "too_long" | "invalid_email" | "invalid_choice";
export type EnquiryError = { field: EnquiryField; code: EnquiryErrorCode };

export type EnquiryResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; errors: EnquiryError[] }
  | { ok: false; reason: "rate_limited" | "server_error" };

// Code points, not UTF-16 units — an emoji is one character to the person
// typing it (the /ideas rule).
export function textLength(s: string): number {
  return Array.from(s).length;
}

// Trim, collapse runs of inline whitespace, drop control characters except
// the newlines a brief may carry. A single-line field also loses its
// newlines — they would break the email's "Label: value" lines.
function clean(raw: unknown, multiline: boolean): string {
  const s = typeof raw === "string" ? raw : "";
  const noCtl = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ");
  const lines = multiline ? noCtl : noCtl.replace(/\n/g, " ");
  return lines
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Deliberately plain: one @, no spaces, a dot in the domain. The address is
// the studio's way back — a typo is the real risk, not RFC 5322 corners.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailErrors(email: string): EnquiryError[] {
  if (!email) return [{ field: "email", code: "required" }];
  if (textLength(email) > ENQUIRY_LIMITS.email) return [{ field: "email", code: "too_long" }];
  if (!EMAIL.test(email)) return [{ field: "email", code: "invalid_email" }];
  return [];
}

function textErrors(
  field: EnquiryField,
  value: string,
  max: number,
  required: boolean,
): EnquiryError[] {
  if (!value) return required ? [{ field, code: "required" }] : [];
  if (textLength(value) > max) return [{ field, code: "too_long" }];
  return [];
}

export function normalizeStudioBrief(input: Partial<StudioBriefInput>): StudioBriefInput {
  return {
    name: clean(input.name, false),
    email: clean(input.email, false).toLowerCase(),
    projectType: clean(input.projectType, false),
    brief: clean(input.brief, true),
    timeline: clean(input.timeline, false),
    budget: clean(input.budget, false),
    website: clean(input.website, false),
  };
}

// In the order the form shows the fields, so errors[0] is the first one on
// screen — where the form moves the focus.
export function validateStudioBrief(v: StudioBriefInput): EnquiryError[] {
  return [
    ...textErrors("name", v.name, ENQUIRY_LIMITS.name, true),
    ...emailErrors(v.email),
    ...(v.projectType
      ? projectTypeLabel(v.projectType)
        ? []
        : [{ field: "projectType" as const, code: "invalid_choice" as const }]
      : [{ field: "projectType" as const, code: "required" as const }]),
    ...textErrors("brief", v.brief, ENQUIRY_LIMITS.brief, true),
    ...textErrors("timeline", v.timeline, ENQUIRY_LIMITS.timeline, false),
    ...(v.budget && !budgetLabel(v.budget)
      ? [{ field: "budget" as const, code: "invalid_choice" as const }]
      : []),
  ];
}

export function normalizeScreenerRequest(
  input: Partial<ScreenerRequestInput>,
): ScreenerRequestInput {
  return {
    title: clean(input.title, false),
    name: clean(input.name, false),
    company: clean(input.company, false),
    email: clean(input.email, false).toLowerCase(),
    market: clean(input.market, false),
    website: clean(input.website, false),
  };
}

// `titleSlugs` = the slugs on offer (lib/licensing.ts). "" is always fine:
// the buyer asks about the catalogue as a whole.
export function validateScreenerRequest(
  v: ScreenerRequestInput,
  titleSlugs: readonly string[],
): EnquiryError[] {
  return [
    ...(v.title && !titleSlugs.includes(v.title)
      ? [{ field: "title" as const, code: "invalid_choice" as const }]
      : []),
    ...textErrors("name", v.name, ENQUIRY_LIMITS.name, true),
    ...textErrors("company", v.company, ENQUIRY_LIMITS.company, true),
    ...emailErrors(v.email),
    ...textErrors("market", v.market, ENQUIRY_LIMITS.market, true),
  ];
}
