// The rules of the /ideas story-idea form (#297) — universal and pure, no
// `server-only`: the client form validates with it as the fan types and the
// server action (app/(public)/ideas/actions.ts:submitIdea) validates with it
// again, so the limits, the length measure and the error codes cannot drift
// between the two. The constants and types live here because a "use server"
// file may export async functions only.

export const IDEA_LIMITS = {
  logline: 300,
  story: 10_000,
  workingTitle: 100,
  name: 80,
  email: 254, // RFC 3696 — full address upper bound
} as const;

// Version of the texts a fan agrees to by sending an idea: the Idea
// Submission Terms AND the wording of ticks 1–3. Stamped on every row by the
// server. Bump it on ANY edit of the Terms or of those three ticks, in ANY
// language — otherwise the stamp stops proving which text the person agreed
// to. One version for both languages. DRAFT until counsel has reviewed it.
export const IDEA_TERMS_VERSION = "ideas-2026-09-draft1";

// The series select's value for "A brand-new series"; every other value is a
// published show's slug.
export const NEW_SERIES_VALUE = "new";

// Submissions per hashed client IP per clock-hour (the checkout limiter's
// table, key `idea:` + HMAC of the IP). A constant, not an env var: a fan
// sends one idea at a time, and ten an hour is far above that and far below
// what a flood needs.
export const IDEA_RATELIMIT_PER_HOUR = 10;

export type IdeaSubmissionInput = {
  /** A published show's slug, or NEW_SERIES_VALUE. */
  series: string;
  workingTitle: string;
  logline: string;
  story: string;
  name: string;
  email: string;
  ageConfirmed: boolean;
  termsAccepted: boolean;
  marketingOptIn: boolean;
  /** Honeypot — a real person never sees or fills it. */
  website: string;
};

/** The form's fields in submit order — the order validateIdeaInput reports them in. */
export type IdeaField =
  | "logline"
  | "series"
  | "workingTitle"
  | "story"
  | "name"
  | "email"
  | "age"
  | "terms";

export type IdeaFieldCode =
  | "logline_required"
  | "logline_too_long"
  | "series_required"
  // Server-only: the slug is not a published show. The form renders it with
  // the series_required copy, so an answer cannot probe which shows exist.
  | "series_unknown"
  | "title_too_long"
  | "story_required"
  | "story_too_long"
  | "name_required"
  | "name_too_long"
  | "email_invalid"
  | "age_required"
  | "terms_required";

export type IdeaFieldError = { field: IdeaField; code: IdeaFieldCode };

export type IdeaSubmissionResult =
  // `onList` is the marketing_opt_in value the row actually HOLDS — for a
  // repeat of an already-stored idea that is the first submission's value.
  | { ok: true; onList: boolean }
  | { ok: false; reason: "invalid"; errors: IdeaFieldError[] }
  | { ok: false; reason: "rate_limited" }
  | { ok: false; reason: "server_error" };

// RFC 5322 would be 100+ chars and still not validate for real — the same lax
// check as the reminder capture (app/watch/actions.ts), kept as a copy here
// so this module stays universal.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One canonical form for every text field: CRLF and lone CR become LF (a
 * textarea submits CRLF, and counting it twice would push a story that fits
 * over the cap), NUL is removed (Postgres text refuses it), and the ends are
 * trimmed. Anything that is not a string — a forged request — is empty.
 */
export function normalizeIdeaText(s: unknown): string {
  if (typeof s !== "string") return "";
  // split/join rather than a /\u0000/ regex (no-control-regex) or
  // replaceAll (older iOS Safari).
  return s.replace(/\r\n?/g, "\n").split("\u0000").join("").trim();
}

/**
 * Length in Unicode code points after normalisation — the measure the form's
 * counters show and the one Postgres `char_length` reports, so an emoji is
 * one character everywhere (a UTF-16 `.length` would count it as two).
 */
export function ideaTextLength(s: unknown): number {
  return Array.from(normalizeIdeaText(s)).length;
}

/** Trimmed and lowercased — the address as stored, compared and deduped. */
export function normalizeIdeaEmail(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

/** The input with every field in its canonical form; non-booleans are false. */
export function normalizeIdeaInput(input: unknown): IdeaSubmissionInput {
  const raw = (
    input !== null && typeof input === "object" ? input : {}
  ) as Partial<Record<keyof IdeaSubmissionInput, unknown>>;
  return {
    series: normalizeIdeaText(raw.series),
    workingTitle: normalizeIdeaText(raw.workingTitle),
    logline: normalizeIdeaText(raw.logline),
    story: normalizeIdeaText(raw.story),
    name: normalizeIdeaText(raw.name),
    email: normalizeIdeaEmail(raw.email),
    ageConfirmed: raw.ageConfirmed === true,
    termsAccepted: raw.termsAccepted === true,
    marketingOptIn: raw.marketingOptIn === true,
    website: normalizeIdeaText(raw.website),
  };
}

/**
 * Every problem with the input, in submit order: logline → series →
 * workingTitle → story → name → email → age → terms. Empty = valid as far as
 * the form can tell; whether the series slug is a published show is the
 * server's question (series_unknown). The honeypot is not validated here.
 */
export function validateIdeaInput(input: IdeaSubmissionInput): IdeaFieldError[] {
  const v = normalizeIdeaInput(input);
  const errors: IdeaFieldError[] = [];

  const logline = ideaTextLength(v.logline);
  if (logline === 0) errors.push({ field: "logline", code: "logline_required" });
  else if (logline > IDEA_LIMITS.logline) {
    errors.push({ field: "logline", code: "logline_too_long" });
  }

  if (!v.series) errors.push({ field: "series", code: "series_required" });

  if (ideaTextLength(v.workingTitle) > IDEA_LIMITS.workingTitle) {
    errors.push({ field: "workingTitle", code: "title_too_long" });
  }

  const story = ideaTextLength(v.story);
  if (story === 0) errors.push({ field: "story", code: "story_required" });
  else if (story > IDEA_LIMITS.story) {
    errors.push({ field: "story", code: "story_too_long" });
  }

  const name = ideaTextLength(v.name);
  if (name === 0) errors.push({ field: "name", code: "name_required" });
  else if (name > IDEA_LIMITS.name) {
    errors.push({ field: "name", code: "name_too_long" });
  }

  if (
    !v.email ||
    v.email.length > IDEA_LIMITS.email ||
    !EMAIL_RE.test(v.email)
  ) {
    errors.push({ field: "email", code: "email_invalid" });
  }

  if (!v.ageConfirmed) errors.push({ field: "age", code: "age_required" });
  if (!v.termsAccepted) errors.push({ field: "terms", code: "terms_required" });

  return errors;
}
