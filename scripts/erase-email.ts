// Erasure (GDPR art. 17) for an ADDRESS that has no account: the rows of
// show_reminders and idea_submissions keyed by the lowercased address, both
// in ONE transaction. Runbook: docs/runbooks/gdpr-requests.md §2 «Адрес без
// аккаунта». The logic lives in lib/address-requests.ts with its tests; this
// file only hands in the database and the console.
//
//   DATABASE_URL=postgres://… pnpm erase-email <address>            # dry run (default)
//   DATABASE_URL=postgres://… pnpm erase-email <address> --apply    # erase
//
// Deliberately NOT loading .env.local: that file carries the PRODUCTION
// connection string, and deleting a person's rows has to be an explicit act
// — DATABASE_URL is passed on the command line (exit 2 without it). An
// address that belongs to an account (users.email, any letter case) is
// REFUSED with the account's id (exit 4): that account is erased through its
// own path, `pnpm erase-user`, which also handles Stripe and PostHog.
//
// Dry run prints the counts and the row ids an --apply would delete, and
// writes nothing. --apply is idempotent: a second run finds nothing. Stdout
// carries ids and counts only — never the address (it is shown as
// `address#<hash>`, the runbook's register hash) and never a value.
//
// Exit codes: 2 — bad arguments or no DATABASE_URL (nothing done); 4 — the
// address belongs to an account (nothing read or changed); 1 — the database
// failed (re-run: it converges); 0 — done.
import { runEraseEmail } from "../lib/address-requests";

runEraseEmail(process.argv.slice(2), process.env, {
  // Dynamic import so the database client loads only after the gates inside
  // the command — the precedent every script here follows.
  getDb: async () => (await import("../db/index.js")).db,
  io: { out: console.log, err: console.error },
}).then(
  (code) => process.exit(code),
  () => {
    // The command reports its own failures; this is a bug in the glue.
    console.error("erase-email failed (unexpected)");
    process.exit(1);
  },
);
