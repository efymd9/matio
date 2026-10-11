"use server";

import { redirect } from "next/navigation";
import { describeDbError } from "@/lib/db-errors";
import {
  decodeUnsubscribeParams,
  unsubscribeEmail,
  verifyUnsubscribeToken,
} from "@/lib/email-unsubscribe";

// Confirm-button handler for /unsubscribe. The deletion deliberately
// happens on POST (server action), never on the page's GET render —
// mail-client link scanners prefetch GETs and must not be able to
// unsubscribe anyone. Params are re-verified here because the bind()
// values come from the URL, not from anything we rendered.
export async function confirmUnsubscribe(
  e: string,
  t: string,
): Promise<void> {
  const parsed = decodeUnsubscribeParams(e, t);
  if (!parsed || !verifyUnsubscribeToken(parsed.email, parsed.token)) {
    // Renders the invalid-link state (no params → invalid).
    redirect("/unsubscribe");
  }
  try {
    await unsubscribeEmail(parsed.email);
  } catch (err) {
    // The address is still on the list, so never the done page. The failure
    // goes on as an error — the app's error page says so and offers a retry
    // (the link is still in the URL), and onRequestError reports it — but as
    // a fresh one carrying class and SQLSTATE only: the statements bind the
    // address, and Next prints whatever escapes to the runtime log (#350).
    const { name, code } = describeDbError(err);
    console.error("confirmUnsubscribe: failed", { name, code });
    throw new Error(`confirmUnsubscribe: failed (${name}, ${code ?? "no code"})`);
  }
  redirect("/unsubscribe?done=1");
}
