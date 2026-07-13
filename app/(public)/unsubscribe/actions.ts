"use server";

import { redirect } from "next/navigation";
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
  await unsubscribeEmail(parsed.email);
  redirect("/unsubscribe?done=1");
}
