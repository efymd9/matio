// Readiness — "can this deployment actually do its job", as opposed to
// `/api/healthz`, which answers "is the process alive and which build is it".
// The two are deliberately separate: healthz must never touch Postgres (every
// uptime ping would become load, and a merely slow database would read as an
// outage), so the real dependency check lives here and is polled by whoever
// wants the truth rather than by everyone.
//
// HONEST LIMIT, stated in the /devops skill too: a green /readyz does NOT prove
// the service is serving. Connection-pool exhaustion is sudden, total, and
// invisible to a probe that opens its own cheap query.
//
// The answer carries STATUS AND DURATION ONLY. No connection strings, no
// driver messages, no host names — a public endpoint that echoes the database
// error is a free reconnaissance tool, and the message from `postgres` can
// carry the URL it failed to reach.
import { sql } from "drizzle-orm";

import { db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long a database that is "up" is allowed to take. Neon lives in the same
 * region as the functions (fra1 / eu-central-1), where a `select 1` is single
 * digit milliseconds; two seconds is the cold-start-and-then-some ceiling,
 * short enough that a monitor polling this never hangs on a wedged pool.
 */
export const DB_PING_TIMEOUT_MS = 2_000;

/**
 * Why the check failed, as a closed set of codes.
 *
 * `not_configured` is its own answer because `db/index.ts` is a lazy Proxy: it
 * builds the client on FIRST QUERY, so a deployment without `DATABASE_URL`
 * (Vercel previews) is perfectly happy until something asks — and what it
 * throws then is a plain `Error` that would surface as an anonymous 500.
 */
type FailureReason = "timeout" | "unavailable" | "not_configured";

type Check =
  | { status: "ok" }
  | { status: "error"; reason: FailureReason };

async function pingDatabase(): Promise<Check> {
  if (!process.env.DATABASE_URL) return { status: "error", reason: "not_configured" };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<Check>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: "error", reason: "timeout" }),
        DB_PING_TIMEOUT_MS,
      );
    });
    // The one raw statement in the app (migrations aside): `select 1` is the
    // whole point — it proves a connection can be taken from the pooler and a
    // round trip completed, and touches no table.
    //
    // The query itself is NOT cancelled on timeout — postgres-js has no cheap
    // way to — so a wedged database can leave the probe's connection busy.
    // Bounded and acceptable: the answer is still returned in two seconds, and
    // the alternative is a probe that hangs for as long as the outage lasts.
    const query = db.execute(sql`select 1`).then(
      (): Check => ({ status: "ok" }),
      (): Check => ({ status: "error", reason: "unavailable" }),
    );
    return await Promise.race([query, timeout]);
  } catch {
    // A synchronous throw from the lazy client (a malformed DATABASE_URL, say)
    // never reaches the promise above.
    return { status: "error", reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const startedAt = Date.now();
  const database = await pingDatabase();
  const durationMs = Date.now() - startedAt;

  if (database.status === "error") {
    // The reason CODE only — never the caught error. This line is covered by
    // the log audit (lib/log-audit.test.ts): a `console.error(error)` here
    // would put the connection string in the platform's log stream.
    console.error("readyz: database check failed", {
      reason: database.reason,
      durationMs,
    });
  }

  return Response.json(
    {
      status: database.status === "ok" ? "ok" : "error",
      checks: { database: { ...database, durationMs } },
    },
    {
      // 503, not 500: this is "not ready to serve", the status every load
      // balancer and uptime monitor already understands.
      status: database.status === "ok" ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
