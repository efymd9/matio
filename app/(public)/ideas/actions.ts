"use server";

import crypto from "node:crypto";
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
import { describeDbError } from "@/lib/db-errors";
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

    // The hourly brake per hashed client IP bucket — an IPv6 client per /64,
    // because it can rotate its address inside the prefix at will and this
    // brake is the form's only defence against a script (a headless bot never
    // fills the honeypot); hashClientIp buckets, lib/ip-bucket.ts — fail-open
    // on a DB error, like the checkout brakes. The raw IP goes nowhere; the
    // key is `idea:` + HMAC of the bucket, so it never collides with the
    // checkout keys.
    const ip = getClientIp({ headers: await headers() });
    if (
      await checkoutRateLimited(
        "idea:" + hashClientIp(ip),
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
