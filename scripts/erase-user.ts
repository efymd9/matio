// Account erasure (GDPR art. 17) for ONE Clerk id, by hand — the same
// code the Clerk `user.deleted` webhook runs (lib/erase-user.ts:eraseUser),
// for the two cases the webhook cannot cover: it never arrived, or a
// restore from backup brought the rows back (docs/runbooks/db-restore.md
// §7). Runbook: docs/runbooks/gdpr-requests.md §4. The account must already
// be deleted in Clerk — this script does not delete it there.
//
//   DATABASE_URL=postgres://… pnpm erase-user <userId>           # dry run (default)
//   DATABASE_URL=postgres://… pnpm erase-user <userId> --apply   # erase
//
// Deliberately NOT loading .env.local: that file carries the PRODUCTION
// connection string and live vendor keys, and deleting a person's rows has
// to be an explicit act — every variable is passed on the command line.
// DATABASE_URL is required (exit 2 without it). The vendor halves are
// best-effort and opt-in by variable, like the export script:
// STRIPE_SECRET_KEY (a live subscription is set to cancel at period end, and
// EVERY Stripe customer carrying the account's address is found by
// customers.search and tombstoned — #223), POSTHOG_PERSONAL_API_KEY +
// POSTHOG_PROJECT_ID (the person and its events are deleted) — unset → that
// step is skipped and SAID so.
//
// Dry run prints the row COUNTS an --apply would delete or de-identify, the
// Stripe customer / tombstone / live-subscription facts, the customer ids
// Stripe finds for the address (the only way to see the tombstone's scope
// before --apply) and how many PostHog persons carry the id; it writes
// nothing anywhere. --apply is idempotent: a second run finds no users row
// and changes nothing locally (the PostHog step still runs — that is how a
// failed one is retried; the Stripe search cannot be — the address is gone
// with the row, so a failed search is a hand step, runbook §4). Stdout
// carries ids, counts and statuses only, never a value.
//
// Exit codes: 2 — bad arguments or no DATABASE_URL (nothing done);
// 1 — the database or a local write failed (re-run: the erasure converges);
// 3 — local erasure complete, but a vendor step is left for a human (the
// lines above the summary say which); 0 — done.
import Stripe from "stripe";

import {
  ERASE_USAGE,
  parseEraseArgs,
  stepsLeftByHand,
  summarizeErasePreview,
  summarizeEraseResult,
} from "../lib/erase-user";

const parsed = parseEraseArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.message}\n\n${ERASE_USAGE}`);
  process.exit(2);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL must be passed explicitly (this script does not read .env.local on purpose):\n" +
      `  ${ERASE_USAGE.split("\n")[0].replace("usage: ", "")}`,
  );
  process.exit(2);
}

const { userId, apply } = parsed;

async function main() {
  // Dynamic imports so the database client loads only after the gates
  // above — the precedent every script here follows.
  const { db } = await import("../db/index.js");
  const { eraseUser, previewErasure } = await import("../lib/erase-user.js");

  const posthogKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const posthogProject = process.env.POSTHOG_PROJECT_ID;
  const posthog =
    posthogKey && posthogProject
      ? { key: posthogKey, projectId: posthogProject }
      : null;

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  // Without a key the cancellation surfaces as the same "cancel by hand"
  // line a Stripe outage would produce — and only if there is something to
  // cancel; the customer search reads the same throw as
  // `skipped_unconfigured` (the dry run says so too, so the operator sees
  // BEFORE --apply that the tombstone's scope was not looked up at Stripe).
  const getStripe = () => {
    if (!stripeKey) {
      throw Object.assign(new Error("STRIPE_SECRET_KEY is not set"), {
        name: "StripeKeyMissing",
      });
    }
    return new Stripe(stripeKey);
  };

  console.log(`${apply ? "APPLY" : "DRY RUN"} — erase ${userId}`);
  const preview = await previewErasure(userId, { db, getStripe, posthog });
  console.log(summarizeErasePreview(userId, preview));

  if (!apply) {
    console.log("nothing changed (dry run — re-run with --apply)");
    process.exit(0);
  }

  const result = await eraseUser(userId, { db, getStripe, posthog });
  console.log(summarizeEraseResult(userId, result));

  const left = stepsLeftByHand(result);
  if (left.length > 0) {
    console.log(`left for the operator (${left.length}):`);
    for (const step of left) console.log(`  - ${step}`);
    process.exit(3);
  }
  process.exit(0);
}

main().catch((err) => {
  // Never the message: the postgres driver quotes the connection string and
  // the statement, and the vendors quote request parameters.
  console.error(`erase failed (${err instanceof Error ? err.name : "unknown"})`);
  process.exit(1);
});
