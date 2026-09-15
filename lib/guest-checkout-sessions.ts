import "server-only";
import crypto from "node:crypto";
import { lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { guestCheckoutSessions } from "@/db/schema";
import { describeError } from "@/lib/observability";

// The guest half of "not more than one open, billable Checkout Session per
// buyer" (#224; the signed-in half is createSoleOpenSession in
// app/subscribe/actions.ts, ADR 0002). A pay-first guest has no Stripe
// customer until they pay, and Stripe's `checkout.sessions.list` cannot filter
// by `client_reference_id`, so the buyer's previous session is not findable at
// Stripe — it is remembered here, keyed by the buying party the guest flow
// already has: the `checkout_claim` cookie.
//
// `db` is a parameter rather than the module singleton (the
// lib/user-export-db.ts precedent): the tests hand in a recorder and read the
// statement that would run, because the statement IS the guarantee.

export type GuestSessionDb = Pick<
  PostgresJsDatabase<typeof schema>,
  "insert" | "delete"
>;

// A Checkout Session lives at most 24h (Stripe's default `expires_at`, which
// the guest flow does not shorten), so a row whose LAST claim is older than
// that names a session Stripe has already expired on its own.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// Share of claims that also prune: the same self-cleaning shape as the guest
// rate limiter (lib/checkout-rate-limit.ts) — guest checkouts are rare, one
// extra DELETE in twenty is nothing, and it needs no cron.
export const PRUNE_SHARE = 0.05;

// The table key. An HMAC of the cookie value, never the value: the cookie is
// what /welcome compares against the session's `client_reference_id` before
// minting a one-click sign-in ticket, so a table of raw claim tokens would be
// a table of sign-in tickets. Same salt as the trial IP hash (lib/trial.ts) —
// server-side only, rotates with the signing key. The fallback keeps the type
// non-nullable in a deployment where JWT signing would already be broken.
const CLAIM_HASH_FALLBACK_SALT = "matio-guest-claim-fallback-salt";

export function hashClaimToken(claimToken: string): string {
  const salt =
    process.env.MUX_SIGNING_KEY_PRIVATE_KEY ?? CLAIM_HASH_FALLBACK_SALT;
  return crypto.createHmac("sha256", salt).update(claimToken).digest("hex");
}

// Records `sessionId` as the buyer's live session and returns the id it
// REPLACED — `null` when this buying party had none — so the caller can expire
// the old one by id. Runs the sweep's bookkeeping AFTER the create, like the
// signed-in flow: a claim-then-create would leave two same-instant creates
// both believing they were first.
//
// One statement, on purpose. `INSERT … ON CONFLICT DO UPDATE` takes the row
// lock on the conflicting key and, once it holds it, updates the LATEST
// committed version of the row; `RETURNING old.session_id` (Postgres 18) reads
// the value that version held before this update, and is all-NULL on the plain
// insert path. So of two parallel claims for one cookie, the second waits on
// the first's lock and then sees the first's id — the two can never both come
// back `null`, which is the whole point: a `null` means "nothing to expire",
// and two of them would leave two live sessions. The alternatives were
// considered and rejected: a `(SELECT session_id …)` subquery in RETURNING
// reads the statement's START snapshot, taken before the other transaction
// committed, so both concurrent callers would get `null`; a SELECT … FOR
// UPDATE + UPDATE pair in a transaction is correct too but costs three
// round-trips through the pooler for what one statement says.
//
// Running it twice with the same session id is safe: the second run returns
// that same id, and the caller treats "previous === new" as nothing to do.
export async function claimSoleGuestSession(
  db: GuestSessionDb,
  claimTokenHash: string,
  sessionId: string,
): Promise<string | null> {
  const [row] = await db
    .insert(guestCheckoutSessions)
    .values({ claimTokenHash, sessionId })
    .onConflictDoUpdate({
      target: guestCheckoutSessions.claimTokenHash,
      // created_at is reset on every claim: it is "when this row was last
      // the truth", which is what the prune window below has to measure.
      set: { sessionId, createdAt: sql`now()` },
    })
    .returning({ previousSessionId: sql<string | null>`old.session_id` });

  await pruneStaleRows(db);

  return row?.previousSessionId ?? null;
}

// Best-effort and after the claim has returned its answer: a failed prune is
// hygiene lost for a day, never a lost sale. Awaited so it cannot dangle past
// the serverless response. Logs the error's class — nothing in this table is
// personal, and the driver's message can still quote the statement.
async function pruneStaleRows(db: GuestSessionDb): Promise<void> {
  if (Math.random() >= PRUNE_SHARE) return;
  try {
    await db
      .delete(guestCheckoutSessions)
      .where(
        lt(guestCheckoutSessions.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
      );
  } catch (err) {
    console.warn("claimSoleGuestSession: pruning stale rows failed", {
      error: describeError(err),
    });
  }
}
