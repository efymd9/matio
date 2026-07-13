import { NextResponse, type NextRequest } from "next/server";
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
  await unsubscribeEmail(parsed.email);
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
