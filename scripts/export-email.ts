// Subject-access / portability export (GDPR art. 15 / 20) for an ADDRESS
// that has no account: the two tables written without a login —
// show_reminders and idea_submissions — by the lowercased address.
// Runbook: docs/runbooks/gdpr-requests.md §2 «Адрес без аккаунта». The logic
// lives in lib/address-requests.ts with its tests; this file only hands in
// the database, the console and the filesystem.
//
//   DATABASE_URL=postgres://… pnpm export-email <address> [--out <file>]
//
// Deliberately NOT loading .env.local: that file carries the PRODUCTION
// connection string, and reading a person's record has to be an explicit act
// — DATABASE_URL is passed on the command line (exit 2 without it). An
// address that belongs to an account is refused with the account's id (exit
// 4): that person gets the complete answer from `pnpm export-user-data`.
//
// Output: one JSON file, mode 0600 — it IS the person's data; delete it once
// the reply has gone out. Without --out it lands in the OS temp dir (never
// the working directory: that is the repository, and `.gitignore` covers
// `export-*.json` on top), named after `address#<hash>`, not the address.
// Stdout carries counts and the path only — never the address, never a value.
//
// Exit codes: 2 — bad arguments or no DATABASE_URL (nothing done); 4 — the
// address belongs to an account (nothing read); 1 — the database or the
// file write failed; 0 — the file is written.
import { tmpdir } from "node:os";

import { runExportEmail, writePrivateFile } from "../lib/address-requests";

runExportEmail(process.argv.slice(2), process.env, {
  // Dynamic import so the database client loads only after the gates inside
  // the command — the precedent every script here follows.
  getDb: async () => (await import("../db/index.js")).db,
  io: { out: console.log, err: console.error },
  tmpDir: tmpdir(),
  writeFile: writePrivateFile,
}).then(
  (code) => process.exit(code),
  () => {
    // The command reports its own failures; this is a bug in the glue.
    console.error("export-email failed (unexpected)");
    process.exit(1);
  },
);
