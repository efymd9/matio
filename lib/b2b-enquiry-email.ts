import "server-only";
import crypto from "node:crypto";
import { emailFrom, getResend, resendConfigured } from "./resend";

// The studio inbox both B2B forms land in (#498). Not stored anywhere else:
// the email IS the enquiry — no table, no admin page, so nothing here for the
// retention cron or the erasure cascade to forget (data map, #498).
export const ENQUIRY_INBOX = "maksym@matio.tv";

export type EnquiryEmail = {
  // "studio" | "screener" — the subject prefix and the dedupe namespace.
  kind: string;
  subject: string;
  // "Label: value" pairs, in reading order; empty values are dropped.
  fields: readonly (readonly [string, string])[];
  // The free-text body under the fields (the brief), optional.
  body?: string;
  // The sender's validated address: a reply goes straight to them.
  replyTo: string;
};

export function renderEnquiryText(e: EnquiryEmail): string {
  const lines = e.fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  const parts = [lines.join("\n")];
  if (e.body) parts.push(e.body);
  parts.push(
    "—\nSent from the form on matio.tv. Reply to this email to answer the sender directly.",
  );
  return parts.join("\n\n");
}

export type SendOutcome = { ok: true } | { ok: false; code: string };

// Never throws. Plain text only — no HTML, so nothing a sender types can
// become markup in the inbox. The subject is built by the caller from OUR
// labels and catalogue titles, never from free text.
//
// Idempotent: the key is a digest of the whole rendered email, so a double
// tap or a retried request inside Resend's 24h window sends nothing new,
// while a corrected enquiry (any field changed) is a new email.
//
// The failure code is Resend's error NAME (e.g. "validation_error") or the
// thrown error's class — never a message: Resend quotes addresses in its
// error text.
export async function sendEnquiryEmail(e: EnquiryEmail): Promise<SendOutcome> {
  if (!resendConfigured()) return { ok: false, code: "not_configured" };
  const text = renderEnquiryText(e);
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([e.subject, e.replyTo, text]))
    .digest("hex");
  try {
    const { error } = await getResend().emails.send(
      {
        from: emailFrom(),
        to: ENQUIRY_INBOX,
        replyTo: e.replyTo,
        subject: e.subject,
        text,
      },
      { idempotencyKey: `enquiry/${e.kind}/${digest}` },
    );
    if (error) return { ok: false, code: error.name || "resend_error" };
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err instanceof Error ? err.name : "unknown" };
  }
}
