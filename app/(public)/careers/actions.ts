"use server";

import crypto from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { db } from "@/db";
import { jobApplications } from "@/db/schema";
import type { JobPosition } from "@/lib/careers";
import { checkoutRateLimited } from "@/lib/checkout-rate-limit";
import { describeDbError } from "@/lib/db-errors";
import {
  JOB_APPLICATION_RATELIMIT_PER_HOUR,
  normalizeJobApplication,
  validateJobApplication,
  type JobApplicationInput,
  type JobApplicationResult,
  type JobSocialLink,
} from "@/lib/job-application";
import { getClientIp, hashClientIp } from "@/lib/trial";

// A job application from the public /careers page (#376). Anonymous — no
// account, no Clerk. The page hands this action to the client form as a prop.
//
// NEVER throws and never rejects (the submitIdea contract): user input gets a
// typed answer (a thrown message is masked in prod), and so does an
// infrastructure failure. The second half is the privacy half: a Drizzle
// error quotes the statement's parameters — the name, the address, the links,
// the message — and an unhandled throw would carry that text to Sentry
// through onRequestError. So everything past validation runs inside ONE
// try/catch that reports the error's class and SQLSTATE only.
//
// Idempotent on the natural key (email, position, content_hash): a double
// tap, a lost response or a retry of the same application lands on ON
// CONFLICT DO NOTHING and gets the same `ok: true` a new row gets.

export async function submitJobApplication(
  input: JobApplicationInput,
): Promise<JobApplicationResult> {
  try {
    const v = normalizeJobApplication(input);

    // Honeypot: a bot filled the off-screen field. Swallowed with a success
    // so it learns nothing; nothing is written and the brake is not touched.
    // Logged without any data so a spike stays visible.
    if (v.website) {
      console.info("submitJobApplication: honeypot");
      return { ok: true };
    }

    // The form's own rules. The brake is not touched: fixing a typo must not
    // burn the hourly budget.
    const errors = validateJobApplication(v);
    if (errors.length > 0) return { ok: false, reason: "invalid", errors };

    // The hourly brake per hashed client IP bucket — an IPv6 client per /64
    // (hashClientIp buckets, lib/ip-bucket.ts), fail-open on a DB error like
    // the checkout brakes. The raw IP goes nowhere; the key is `job:` + HMAC
    // of the bucket, so it never collides with the checkout or idea keys.
    const ip = getClientIp({ headers: await headers() });
    if (
      await checkoutRateLimited(
        "job:" + hashClientIp(ip),
        JOB_APPLICATION_RATELIMIT_PER_HOUR,
      )
    ) {
      return { ok: false, reason: "rate_limited" };
    }

    // validateJobApplication has proven the position and every row's
    // platform; the casts only tell the compiler.
    const position = v.position as JobPosition;
    const socialLinks = v.socials as JobSocialLink[];
    const linkedinUrl = v.linkedinUrl || null;
    const portfolioUrl = v.portfolioUrl || null;
    const contentHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify([
          v.fullName,
          v.location,
          linkedinUrl,
          portfolioUrl,
          socialLinks.map((s) => [s.platform, s.value]),
          v.message,
        ]),
      )
      .digest("hex");

    await db
      .insert(jobApplications)
      .values({
        position,
        fullName: v.fullName,
        email: v.email,
        location: v.location,
        linkedinUrl,
        portfolioUrl,
        socialLinks,
        message: v.message,
        contentHash,
      })
      .onConflictDoNothing({
        target: [
          jobApplications.email,
          jobApplications.position,
          jobApplications.contentHash,
        ],
      });

    return { ok: true };
  } catch (e) {
    // Class and SQLSTATE only (walked down `.cause` — Drizzle wraps the
    // driver error); never the message, never a form value, in the log or
    // in Sentry. Sentry so that a 42P01 (the migration missing) shows up
    // somewhere other than the Vercel logs.
    const { name, code } = describeDbError(e);
    console.error("submitJobApplication: failed", { name, code });
    Sentry.captureMessage("submitJobApplication: failed", {
      level: "error",
      tags: { code: code ?? "none", name },
    });
    return { ok: false, reason: "server_error" };
  }
}
