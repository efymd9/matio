import { VACANCIES, isJobPosition } from "./careers";

// The rules of the /careers application form (#376) — universal and pure, no
// `server-only`: the client form validates with it as the candidate types and
// the server action (app/(public)/careers/actions.ts:submitJobApplication)
// validates with it again, so the limits, the link rule and the error codes
// cannot drift between the two (the lib/idea-submission.ts precedent). The
// constants and types live here because a "use server" file may export async
// functions only.

export const JOB_LIMITS = {
  fullName: 100,
  email: 254, // RFC 3696 — full address upper bound
  location: 100,
  /** Every link — LinkedIn, portfolio, a social profile. */
  link: 300,
  message: 2_000,
  /** Social profile rows. */
  socials: 4,
} as const;

// Applications per hashed client IP per clock-hour (the checkout limiter's
// table, key `job:` + HMAC of the IP bucket). A constant, not an env var: a
// candidate applies once or twice, and five an hour is far above that and far
// below what a flood needs.
export const JOB_APPLICATION_RATELIMIT_PER_HOUR = 5;

// How long an application is kept — /privacy §6 "Job applications", executed
// by the retention cron (lib/retention.ts). The form's privacy line and the
// FAQ say the same number.
export const JOB_APPLICATION_RETENTION_MONTHS = 6;

export const SOCIAL_PLATFORMS = [
  "tiktok",
  "instagram",
  "youtube",
  "x",
  "other",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  other: "Other",
};

/** One social profile as stored in job_applications.social_links. */
export type JobSocialLink = { platform: SocialPlatform; value: string };

export type JobApplicationInput = {
  /** A vacancy id (lib/careers.ts). */
  position: string;
  fullName: string;
  email: string;
  location: string;
  linkedinUrl: string;
  portfolioUrl: string;
  /** Rows with an empty value are dropped, not refused. */
  socials: { platform: string; value: string }[];
  message: string;
  ageConfirmed: boolean;
  /** Honeypot — a real person never sees or fills it. */
  website: string;
};

/** The form's fields in submit order — the order validateJobApplication reports them in. */
export type JobField =
  | "position"
  | "fullName"
  | "email"
  | "location"
  | "linkedin"
  | "portfolio"
  | "socials"
  | "message"
  | "age";

export type JobFieldCode =
  | "position_required"
  | "name_required"
  | "name_too_long"
  | "email_required"
  | "email_invalid"
  | "location_required"
  | "location_too_long"
  | "linkedin_invalid"
  | "portfolio_required"
  | "portfolio_invalid"
  | "socials_too_many"
  | "social_invalid"
  | "message_required"
  | "message_too_long"
  | "age_required";

export type JobFieldError = {
  field: JobField;
  code: JobFieldCode;
  /** For `social_invalid`: which row (0-based, among the non-empty rows). */
  index?: number;
};

export type JobApplicationResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; errors: JobFieldError[] }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "server_error" };

// The same lax check as the /ideas form and the reminder capture — RFC 5322
// would be 100+ characters and still not validate for real.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// An @handle: what a candidate types for a profile instead of a link.
const HANDLE_RE = /^@[A-Za-z0-9._-]{1,60}$/;

/**
 * One canonical form for every text field: CRLF and lone CR become LF (a
 * textarea submits CRLF, and counting it twice would push a message that
 * fits over the cap), NUL is removed (Postgres text refuses it), and the
 * ends are trimmed. Anything that is not a string — a forged request — is
 * empty.
 */
export function normalizeJobText(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\r\n?/g, "\n").split("\u0000").join("").trim();
}

/**
 * Length in Unicode code points after normalisation — the measure the
 * counter shows and Postgres `char_length` reports (an emoji is one).
 */
export function jobTextLength(s: unknown): number {
  return Array.from(normalizeJobText(s)).length;
}

/**
 * Trimmed and lowercased — the address as stored, compared and erased. NUL
 * is removed like in every other field: Postgres text refuses it, and a
 * forged address carrying one would otherwise end as a 22021 server_error.
 */
export function normalizeJobEmail(s: unknown): string {
  return typeof s === "string" ? s.split("\u0000").join("").trim().toLowerCase() : "";
}

/**
 * A link we store: written out with `http://` or `https://`, parses as a URL
 * with that very scheme and a dotted host, no whitespace, within the length
 * cap. Anything else — `javascript:`, `data:`, a bare `linkedin.com/in/…`, a
 * relative path — is refused, so the admin panel can make a stored link
 * clickable without a second look at its scheme.
 */
export function isHttpLink(value: string): boolean {
  if (value.length === 0 || value.length > JOB_LIMITS.link) return false;
  if (/\s/.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname.includes(".")
    );
  } catch {
    return false;
  }
}

/** An @handle in the shape the form accepts. */
export function isSocialHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

/** The input with every field in its canonical form; a non-boolean tick is false. */
export function normalizeJobApplication(input: unknown): JobApplicationInput {
  const raw = (
    input !== null && typeof input === "object" ? input : {}
  ) as Partial<Record<keyof JobApplicationInput, unknown>>;
  const socials = Array.isArray(raw.socials) ? raw.socials : [];
  return {
    position: normalizeJobText(raw.position),
    fullName: normalizeJobText(raw.fullName),
    email: normalizeJobEmail(raw.email),
    location: normalizeJobText(raw.location),
    linkedinUrl: normalizeJobText(raw.linkedinUrl),
    portfolioUrl: normalizeJobText(raw.portfolioUrl),
    socials: socials
      .map((row: unknown) => {
        const r = (
          row !== null && typeof row === "object" ? row : {}
        ) as Record<string, unknown>;
        return {
          platform: normalizeJobText(r.platform),
          value: normalizeJobText(r.value),
        };
      })
      // A row left blank is not an answer — dropped, never refused.
      .filter((row) => row.value.length > 0),
    message: normalizeJobText(raw.message),
    ageConfirmed: raw.ageConfirmed === true,
    website: normalizeJobText(raw.website),
  };
}

/** Whether the portfolio field is required for this position. */
export function portfolioRequiredFor(position: string): boolean {
  return isJobPosition(position) && VACANCIES[position].portfolioRequired;
}

/**
 * Every problem with the input, in submit order: position → fullName →
 * email → location → linkedin → portfolio → socials → message → age.
 * Empty = valid. The honeypot is not validated here.
 */
export function validateJobApplication(input: unknown): JobFieldError[] {
  const v = normalizeJobApplication(input);
  const errors: JobFieldError[] = [];

  if (!isJobPosition(v.position)) {
    errors.push({ field: "position", code: "position_required" });
  }

  const name = jobTextLength(v.fullName);
  if (name === 0) errors.push({ field: "fullName", code: "name_required" });
  else if (name > JOB_LIMITS.fullName) {
    errors.push({ field: "fullName", code: "name_too_long" });
  }

  if (!v.email) errors.push({ field: "email", code: "email_required" });
  else if (v.email.length > JOB_LIMITS.email || !EMAIL_RE.test(v.email)) {
    errors.push({ field: "email", code: "email_invalid" });
  }

  const location = jobTextLength(v.location);
  if (location === 0) errors.push({ field: "location", code: "location_required" });
  else if (location > JOB_LIMITS.location) {
    errors.push({ field: "location", code: "location_too_long" });
  }

  if (v.linkedinUrl && !isHttpLink(v.linkedinUrl)) {
    errors.push({ field: "linkedin", code: "linkedin_invalid" });
  }

  if (!v.portfolioUrl) {
    if (portfolioRequiredFor(v.position)) {
      errors.push({ field: "portfolio", code: "portfolio_required" });
    }
  } else if (!isHttpLink(v.portfolioUrl)) {
    errors.push({ field: "portfolio", code: "portfolio_invalid" });
  }

  if (v.socials.length > JOB_LIMITS.socials) {
    errors.push({ field: "socials", code: "socials_too_many" });
  } else {
    v.socials.forEach((row, index) => {
      const platformOk = (SOCIAL_PLATFORMS as readonly string[]).includes(row.platform);
      const valueOk = isSocialHandle(row.value) || isHttpLink(row.value);
      if (!platformOk || !valueOk) {
        errors.push({ field: "socials", code: "social_invalid", index });
      }
    });
  }

  const message = jobTextLength(v.message);
  if (message === 0) errors.push({ field: "message", code: "message_required" });
  else if (message > JOB_LIMITS.message) {
    errors.push({ field: "message", code: "message_too_long" });
  }

  if (!v.ageConfirmed) errors.push({ field: "age", code: "age_required" });

  return errors;
}

/** The first word of the name — the success card's greeting. */
export function firstNameOf(fullName: string): string {
  return normalizeJobText(fullName).split(/\s+/)[0] ?? "";
}
