import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { showReminders } from "@/db/schema";

// Unsubscribe links for reminder emails. Every outgoing email carries two
// token-authenticated URLs for the same address:
//   - page URL (/unsubscribe?e=…&t=…) — the human-facing footer link; the
//     page confirms with a button before deleting, so mail-client link
//     scanners (Outlook SafeLinks etc.) prefetching the GET can't
//     unsubscribe anyone.
//   - one-click URL (/api/email/unsubscribe?e=…&t=…) — the RFC 8058
//     List-Unsubscribe POST target Gmail/Yahoo require; POST unsubscribes
//     immediately, GET redirects to the page.
//
// The token is an HMAC over the lowercased address, salted with the Mux
// signing key — same reuse-an-existing-server-secret reasoning as
// lib/trial.ts's hashClientIp (already required server-side, never shipped
// to the client). The fallback constant only keeps the type non-nullable
// in broken deployments; real tokens then fail verification (fail closed).
const UNSUBSCRIBE_FALLBACK_SECRET = "matio-unsubscribe-fallback-secret";

function unsubscribeSecret(): string {
  return process.env.MUX_SIGNING_KEY_PRIVATE_KEY ?? UNSUBSCRIBE_FALLBACK_SECRET;
}

export function unsubscribeToken(email: string): string {
  return crypto
    .createHmac("sha256", unsubscribeSecret())
    .update(`unsubscribe:${email.toLowerCase()}`)
    .digest("base64url");
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email));
  const provided = Buffer.from(token);
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}

// The address rides in the URL base64url-encoded so `+` addressing and `@`
// survive every mail client's URL handling without percent-escape drift.
export function unsubscribeUrls(email: string): {
  page: string;
  oneClick: string;
} {
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://matio.tv";
  const qs = `e=${Buffer.from(email.toLowerCase()).toString("base64url")}&t=${unsubscribeToken(email)}`;
  return {
    page: `${origin}/unsubscribe?${qs}`,
    oneClick: `${origin}/api/email/unsubscribe?${qs}`,
  };
}

// Shared param parsing for the page and the route handler. Returns null on
// anything malformed; token verification is the caller's next step.
export function decodeUnsubscribeParams(
  e: string | undefined,
  t: string | undefined,
): { email: string; token: string } | null {
  if (!e || !t) return null;
  const email = Buffer.from(e, "base64url").toString("utf8").toLowerCase();
  if (!email || email.length > 254 || !email.includes("@")) return null;
  return { email, token: t };
}

// Deletes every reminder row for the address — pending and sent, across all
// shows. "Stop emailing me" means the ledger forgets the address entirely
// (data minimisation); an explicit later re-submit is fresh consent and
// simply creates new rows.
export async function unsubscribeEmail(email: string): Promise<number> {
  const deleted = await db
    .delete(showReminders)
    .where(eq(showReminders.email, email.toLowerCase()))
    .returning({ id: showReminders.id });
  return deleted.length;
}
