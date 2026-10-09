import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { describeDbError } from "@/lib/db-errors";
import {
  decodeUnsubscribeParams,
  unsubscribeEmail,
  verifyUnsubscribeToken,
} from "@/lib/email-unsubscribe";

// RFC 8058 one-click unsubscribe endpoint — the List-Unsubscribe /
// List-Unsubscribe-Post target on every reminder email. Gmail/Yahoo POST
// here (body `List-Unsubscribe=One-Click`, no cookies) and expect a 2xx
// without any confirmation step. The HMAC token in the query is the
// authentication; the body is ignored.
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = decodeUnsubscribeParams(
    req.nextUrl.searchParams.get("e") ?? undefined,
    req.nextUrl.searchParams.get("t") ?? undefined,
  );
  if (!parsed || !verifyUnsubscribeToken(parsed.email, parsed.token)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }
  try {
    await unsubscribeEmail(parsed.email);
  } catch (err) {
    // The address is still on the list: never a 2xx (the mailbox provider
    // would take it as done). The statements bind the address, so the
    // failure is logged and reported by class and SQLSTATE only (#350) —
    // there is no id to name; the address is the subject.
    const { name, code } = describeDbError(err);
    console.error("email unsubscribe (one-click): failed", { name, code });
    Sentry.captureMessage("email unsubscribe (one-click): failed", {
      level: "error",
      tags: { code: code ?? "none", name },
    });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// Some clients render the List-Unsubscribe URL as a plain link — a human
// GET lands here. Never delete on GET (scanner prefetch); hand off to the
// confirm page instead.
export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  return NextResponse.redirect(
    new URL(`/unsubscribe${qs ? `?${qs}` : ""}`, req.nextUrl.origin),
    307,
  );
}
