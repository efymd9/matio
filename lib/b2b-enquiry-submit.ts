import "server-only";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { checkoutRateLimited } from "./checkout-rate-limit";
import { ENQUIRY_RATELIMIT_PER_HOUR, type EnquiryError, type EnquiryResult } from "./b2b-enquiry";
import { sendEnquiryEmail, type EnquiryEmail } from "./b2b-enquiry-email";
import { getClientIp, hashClientIp } from "./trial";

export type EnquiryKind = "studio" | "screener";

// The one pipeline behind both B2B forms (#498), in the order of the
// submitJobApplication contract: honeypot → the form's own rules → the hourly
// brake → the email. NEVER throws and never rejects: every outcome is a
// typed result, and a failure logs the kind and a code only — the name, the
// address, the company and the brief never reach a log or Sentry.
export async function submitEnquiry(opts: {
  kind: EnquiryKind;
  honeypot: string;
  validate: () => EnquiryError[];
  buildEmail: () => Promise<EnquiryEmail>;
}): Promise<EnquiryResult> {
  const { kind } = opts;
  try {
    // A bot filled the off-screen field: a success, so it learns nothing;
    // nothing is sent and the brake is not touched.
    if (opts.honeypot) {
      console.info("submitEnquiry: honeypot", { kind });
      return { ok: true };
    }

    // Fixing a typo must not burn the hourly budget — validation first.
    const errors = opts.validate();
    if (errors.length > 0) return { ok: false, reason: "invalid", errors };

    // Per hashed client IP bucket (an IPv6 client per /64), fail-open on a
    // DB error like every brake here. The key is `<kind>:` + HMAC, so the
    // two forms keep separate budgets and never collide with other keys.
    const ip = getClientIp({ headers: await headers() });
    if (await checkoutRateLimited(`${kind}:${hashClientIp(ip)}`, ENQUIRY_RATELIMIT_PER_HOUR)) {
      return { ok: false, reason: "rate_limited" };
    }

    const sent = await sendEnquiryEmail(await opts.buildEmail());
    if (sent.ok) return { ok: true };
    return fail(kind, sent.code);
  } catch (e) {
    return fail(kind, e instanceof Error ? e.name : "unknown");
  }
}

function fail(kind: EnquiryKind, code: string): EnquiryResult {
  console.error("submitEnquiry: failed", { kind, code });
  Sentry.captureMessage("submitEnquiry: failed", {
    level: "error",
    tags: { kind, code },
  });
  return { ok: false, reason: "server_error" };
}
