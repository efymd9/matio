import "server-only";
import { Resend } from "resend";

declare global {
  var __resendClient: Resend | undefined;
}

// Email is an optional integration: with RESEND_API_KEY unset the capture
// form still writes to show_reminders (the table is the source of truth,
// not the send), and the admin send panel degrades to a "connect Resend"
// hint. Callers must check this before getResend().
export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Lazy + cached, same pattern as lib/stripe.ts / lib/mux.ts.
export function getResend(): Resend {
  if (globalThis.__resendClient) return globalThis.__resendClient;

  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY must be set");
  }

  const client = new Resend(process.env.RESEND_API_KEY);
  globalThis.__resendClient = client;
  return client;
}

// Sender identity. updates@ keeps transactional sending separate from the
// support mailbox; Reply-To routes human replies to contact@ (the public
// support address). Env overrides exist so a domain/address change never
// needs a code change.
export function emailFrom(): string {
  return process.env.RESEND_FROM ?? "Matio <updates@matio.tv>";
}

export function emailReplyTo(): string {
  return process.env.RESEND_REPLY_TO ?? "contact@matio.tv";
}
