// Daily data-retention run — the trigger for lib/retention.ts, called by
// Vercel Cron (`crons` in vercel.json). The platform invokes the path with
// GET and `Authorization: Bearer <CRON_SECRET>`; nothing else may run it.
//
// FAIL CLOSED: with no CRON_SECRET in the environment every request is 401,
// including the platform's own. A deployment missing the variable deletes
// nothing and says so in its cron log, rather than exposing a public "delete
// my ledgers" button. The answer carries COUNTERS AND TABLE NAMES ONLY — no
// error text, no row content (see the log audit in lib/log-audit.test.ts).
import { timingSafeEqual } from "node:crypto";

import { runRetention } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The run stops itself at RETENTION_TIME_BUDGET_MS (40s), well inside this.
export const maxDuration = 60;

/**
 * Is this the platform's cron call? Bearer-only, whole-header comparison in
 * constant time. A missing or empty secret means "nobody is authorised".
 */
export function isAuthorizedCronRequest(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authorization) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (
    !isAuthorizedCronRequest(
      req.headers.get("authorization"),
      process.env.CRON_SECRET,
    )
  ) {
    return new Response(null, {
      status: 401,
      headers: { "cache-control": "no-store" },
    });
  }

  const result = await runRetention();
  const ok = result.failed.length === 0;
  return Response.json(
    { status: ok ? "ok" : "error", ...result },
    {
      // A failed table is a 500 so the platform's cron log shows the run red;
      // the body still names what did get done.
      status: ok ? 200 : 500,
      headers: { "cache-control": "no-store" },
    },
  );
}
