// Subject-access / portability export (GDPR art. 15 / 20) for ONE account.
// Runbook: docs/runbooks/gdpr-requests.md. The logic lives in lib/ with its
// tests (lib/user-export.ts, lib/user-export-db.ts); this file is the
// argument parser, the environment gate and the glue.
//
//   DATABASE_URL=postgres://… pnpm export-user-data <userId> [--out <file>]
//
// Deliberately NOT loading .env.local: that file carries the PRODUCTION
// connection string and live vendor keys, and reading a person's whole
// record has to be an explicit act — every variable is passed on the
// command line. DATABASE_URL is required (exit 2 without it). The vendor
// halves are best-effort and opt-in by variable: CLERK_SECRET_KEY,
// STRIPE_SECRET_KEY, POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID —
// unset → that processor is `null` in the file with a note to export it by
// hand.
//
// Output: one JSON file, mode 0600 — it IS the person's data; delete it once
// the reply has gone out. Stdout carries counts and ids only, never a value.
import { chmodSync, writeFileSync } from "node:fs";
import Stripe from "stripe";

import { runHogQL } from "../lib/posthog-hogql";
import {
  assembleUserExport,
  defaultExportPath,
  parseExportArgs,
  summarizeExport,
  USAGE,
} from "../lib/user-export";

const parsed = parseExportArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.message}\n\n${USAGE}`);
  process.exit(2);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL must be passed explicitly (this script does not read .env.local on purpose):\n" +
      `  ${USAGE.split("\n")[0].replace("usage: ", "")}`,
  );
  process.exit(2);
}

const { userId } = parsed;
const outPath = parsed.out ?? defaultExportPath(userId, new Date());

async function main() {
  // Dynamic imports so the database client and Clerk's server module load
  // only after the gates above — the precedent every script here follows.
  const { db } = await import("../db/index.js");
  const { loadUserExportRows } = await import("../lib/user-export-db.js");

  const rows = await loadUserExportRows(db, userId);

  const clerk = process.env.CLERK_SECRET_KEY
    ? await (await import("@clerk/nextjs/server")).clerkClient()
    : null;
  const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;
  const posthogKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const posthogProject = process.env.POSTHOG_PROJECT_ID;
  const posthog =
    posthogKey && posthogProject
      ? {
          runHogQL: (query: string) =>
            runHogQL({ key: posthogKey, projectId: posthogProject }, query),
        }
      : null;

  const result = await assembleUserExport({
    userId,
    rows,
    clients: { clerk, stripe, posthog },
  });

  // mode applies on creation only; the chmod makes 0600 true on overwrite.
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(outPath, 0o600);

  console.log(summarizeExport(result));
  console.log(`written ${outPath} (mode 0600) — delete it once the reply has gone out`);
  process.exit(0);
}

main().catch((err) => {
  // Never the message: the postgres driver quotes the connection string and
  // the vendors quote request parameters.
  console.error(`export failed (${err instanceof Error ? err.name : "unknown"})`);
  process.exit(1);
});
