"use server";

import crypto from "node:crypto";
import { isIP } from "node:net";
import * as Sentry from "@sentry/nextjs";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { ideaSubmissions, shows } from "@/db/schema";
import {
  readAttributionCookies,
  toFirstColumns,
  toLastColumns,
} from "@/lib/attribution";
import { checkoutRateLimited } from "@/lib/checkout-rate-limit";
import { getLocale } from "@/lib/i18n/server";
import {
  IDEA_RATELIMIT_PER_HOUR,
  IDEA_TERMS_VERSION,
  NEW_SERIES_VALUE,
  normalizeIdeaInput,
  validateIdeaInput,
  type IdeaSubmissionInput,
  type IdeaSubmissionResult,
} from "@/lib/idea-submission";
import { describeDbError } from "@/lib/retention";
import { getClientIp, hashClientIp } from "@/lib/trial";

// A fan's story idea from the public /ideas landing (#297). Anonymous — no
// account, no Clerk. The page hands this action to the client form as a
// prop.
//
// NEVER throws and never rejects: user input gets a typed answer (the rule
// for form actions — a thrown message is masked in prod), and so does an
// infrastructure failure. The second half is the privacy half: a Drizzle
// error quotes the statement's parameters — the name, the address, the story,
// the client-sent series — and an unhandled throw would carry that text to
// Sentry through onRequestError. So everything past validation runs inside
// ONE try/catch that reports the error's class and SQLSTATE only.
//
// Idempotent on the natural key (email, content_hash): a double tap, a lost
// response or a retry of the same pitch lands on ON CONFLICT DO NOTHING and
// gets the same `ok: true` a new row gets.

// What the hourly brake counts per. An IPv6 client usually holds a whole /64
// (often a /56 or a /48) and can rotate its source address inside it at
// will — keyed per address, every rotation would open a fresh bucket of ten,
// and the brake is this form's only defence against a script (a headless
// bot never fills the honeypot). So an IPv6 address counts by its /64;
// IPv4 — and an IPv4-mapped IPv6 address — by the address itself, and
// anything unparseable ("unknown") as it is.
function brakeSubject(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail] = ip.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  // An embedded dotted IPv4 tail is two 16-bit groups wide.
  const width = (groups: string[]) =>
    groups.reduce((n, g) => n + (g.includes(".") ? 2 : 1), 0);
  const groups =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(Math.max(0, 8 - width(left) - width(right))).fill("0"),
          ...right,
        ];
  const prefix = groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":");
  return `${prefix}::/64`;
}

export async function submitIdea(
  input: IdeaSubmissionInput,
): Promise<IdeaSubmissionResult> {
  try {
    const v = normalizeIdeaInput(input);

    // Honeypot: a bot filled the off-screen field. Swallowed with a
    // success so it learns nothing; nothing is written and the brake is
    // not touched. Logged without any data so a spike stays visible — an
    // over-eager autofill would lose a real idea here.
    if (v.website) {
      console.info("submitIdea: honeypot");
      return { ok: true, onList: false };
    }

    // The form's own rules. The brake is not touched: fixing a typo must
    // not burn the hourly budget.
    const errors = validateIdeaInput(v);
    if (errors.length > 0) return { ok: false, reason: "invalid", errors };

    // The hourly brake per hashed client IP — an IPv6 client per /64
    // (brakeSubject) — fail-open on a DB error, like the checkout brakes.
    // The raw IP goes nowhere; the key is `idea:` + HMAC of it, so it never
    // collides with the checkout keys.
    const ip = getClientIp({ headers: await headers() });
    if (
      await checkoutRateLimited(
        "idea:" + hashClientIp(brakeSubject(ip)),
        IDEA_RATELIMIT_PER_HOUR,
      )
    ) {
      return { ok: false, reason: "rate_limited" };
    }

    // The series: a fresh read, not the catalog cache — an unpublished or
    // deleted show must not collect ideas. series_unknown renders with the
    // series_required copy, so the answer cannot probe which shows exist.
    const kind = v.series === NEW_SERIES_VALUE ? "new_series" : "continuation";
    let showId: string | null = null;
    if (kind === "continuation") {
      const [show] = await db
        .select({ id: shows.id })
        .from(shows)
        .where(
          and(
            eq(shows.slug, v.series),
            eq(shows.status, "published"),
            isNull(shows.deletedAt),
          ),
        )
        .limit(1);
      if (!show) {
        return {
          ok: false,
          reason: "invalid",
          errors: [{ field: "series", code: "series_unknown" }],
        };
      }
      showId = show.id;
    }

    // Snapshots and the write. The attribution cookies exist only under
    // marketing consent (EU/EEA/UK/CH: the banner; elsewhere on by
    // default) — without it the six columns stay NULL. terms_version is
    // always the server's, never the client's.
    const locale = await getLocale();
    const attribution = await readAttributionCookies();
    const contentHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([kind, showId, v.workingTitle, v.logline, v.story]),
      )
      .digest("hex");

    const [inserted] = await db
      .insert(ideaSubmissions)
      .values({
        kind,
        showId,
        workingTitle: v.workingTitle || null,
        logline: v.logline,
        story: v.story,
        authorName: v.name,
        email: v.email,
        locale,
        termsVersion: IDEA_TERMS_VERSION,
        marketingOptIn: v.marketingOptIn,
        contentHash,
        ...toFirstColumns(attribution.first),
        ...toLastColumns(attribution.last),
      })
      .onConflictDoNothing({
        target: [ideaSubmissions.email, ideaSubmissions.contentHash],
      })
      .returning({ marketingOptIn: ideaSubmissions.marketingOptIn });

    // A repeat of a stored pitch leaves the row as it was — marketing_opt_in
    // included, so its consent moment stays created_at — and the answer
    // reports what the row HOLDS: a resend with tick 3 newly ticked will not
    // say "you're on the list". The value is only readable by someone who
    // already knows the address AND the exact text of the pitch.
    let onList = inserted?.marketingOptIn;
    if (onList === undefined) {
      const [existing] = await db
        .select({ marketingOptIn: ideaSubmissions.marketingOptIn })
        .from(ideaSubmissions)
        .where(
          and(
            eq(ideaSubmissions.email, v.email),
            eq(ideaSubmissions.contentHash, contentHash),
          ),
        )
        .limit(1);
      onList = existing?.marketingOptIn ?? false;
    }
    return { ok: true, onList };
  } catch (e) {
    // Class and SQLSTATE only (walked down `.cause` — Drizzle wraps the
    // driver error); never the message, never a form value, in the log or
    // in Sentry. Sentry so that a 42P01 (the migration missing) shows up
    // somewhere other than the Vercel logs.
    const { name, code } = describeDbError(e);
    console.error("submitIdea: failed", { name, code });
    Sentry.captureMessage("submitIdea: failed", {
      level: "error",
      tags: { code: code ?? "none", name },
    });
    return { ok: false, reason: "server_error" };
  }
}
