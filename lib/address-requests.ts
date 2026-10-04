import { createHash } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import type * as schema from "@/db/schema";
import {
  ideaSubmissions,
  showReminders,
  users,
  type IdeaSubmission,
  type ShowReminder,
} from "@/db/schema";
import { describeDbError } from "@/lib/db-errors";

// Subject requests (GDPR art. 15 / 17 / 20) for an ADDRESS that has no
// account — `pnpm -s export-email <address>` and `pnpm -s erase-email
// <address>` (#339). Runbook: docs/runbooks/gdpr-requests.md §2 «Адрес без
// аккаунта». Always `-s`: without it pnpm itself echoes the script line,
// arguments and so the address included, to stdout before a line of ours.
//
// Two tables hold a person who never signed in, both written without a login
// and keyed by the address ALONE: `show_reminders` (the «remind me» form) and
// `idea_submissions` (a story pitch from /ideas, #297 — the author needs no
// account). Everything else the project knows about a person hangs off a
// Clerk id and is served by `pnpm export-user-data` / `erase-user`.
//
// The module is the whole of the two scripts: argument parsing, the
// database reads and the one transaction, the export document, the
// operator's stdout and the exit codes. scripts/export-email.ts and
// scripts/erase-email.ts are only the glue that hands in the database, the
// console and the filesystem — so everything below runs in the tests with a
// stateful fake, and the log audit (lib/log-audit.test.ts) runs the real
// `run…` functions to prove no address comes out of either script — of the
// script's OWN output: pnpm's banner (hence `-s`) and the command line itself,
// which always carries the address, are outside what it can see.
//
// Four rules the shape encodes:
//   * the address is compared LOWERCASED — both tables store it that way
//     (subscribeToShowReminder / submitIdea lowercase before the insert) and
//     `=` on text is exact, so the operator's «Ana.Perez@Example.com» must
//     become «ana.perez@example.com» before it meets a column;
//   * the address NEVER leaves the process in a message: stdout, stderr and
//     the default file name carry `address#<hash>` — the same 8 hex digits
//     the runbook's request register already uses (§1) — and a failure is
//     reported by class + SQLSTATE only (the driver quotes the statement,
//     and a statement carries the address);
//   * an address that BELONGS to an account is refused, with the account's
//     id: that person is served by the account's own path (a complete
//     answer for art. 15, the Stripe / PostHog steps for art. 17), and a
//     by-address run would give an incomplete one;
//   * erasure is dry-run unless told otherwise, and `--apply` deletes both
//     tables in ONE transaction — a half-erased address is the state the
//     operator cannot reason about.

export const ADDRESS_TABLES = ["show_reminders", "idea_submissions"] as const;
export type AddressTable = (typeof ADDRESS_TABLES)[number];

export const EXIT_OK = 0;
/** The database or a file write failed — a re-run converges. */
export const EXIT_FAILED = 1;
/** Bad arguments or no DATABASE_URL — nothing was done. */
export const EXIT_USAGE = 2;
/** The address belongs to an account — nothing was read or changed. */
export const EXIT_REFUSED = 4;

// ── The address ─────────────────────────────────────────────────────────

/** Trimmed and lowercased — the address as both tables store and compare it. */
export function normalizeAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

const ADDRESS_MAX_LEN = 254;

/**
 * A shape check, not validation: one «@» with something on both sides, no
 * whitespace. It exists to catch a pasted name or a stray argument before it
 * becomes a query — a mistyped address simply finds nothing.
 */
export function isAddressShape(address: string): boolean {
  if (address.length === 0 || address.length > ADDRESS_MAX_LEN) return false;
  const at = address.indexOf("@");
  return (
    at > 0 &&
    at === address.lastIndexOf("@") &&
    at < address.length - 1 &&
    !/\s/.test(address)
  );
}

/**
 * The first 8 hex digits of the SHA-256 of the lowercased address — byte for
 * byte what the runbook's one-liner prints (`printf '%s' … | tr 'A-Z' 'a-z'
 * | shasum -a 256 | cut -c1-8`), so a run, a file and a register row can be
 * matched without any of them holding the address.
 */
export function addressRef(address: string): string {
  return createHash("sha256")
    .update(normalizeAddress(address))
    .digest("hex")
    .slice(0, 8);
}

/** The label every message uses for the subject. */
const subjectLabel = (address: string) => `address#${addressRef(address)}`;

/**
 * A failure as the operator sees it: the error's class and the driver's
 * SQLSTATE (or the file system's code), never its message — the driver
 * quotes the statement, and the statement carries the address.
 */
function failureLabel(err: unknown): string {
  const { name, code } = describeDbError(err);
  return code ? `${name}/${code}` : name;
}

// ── Database half ───────────────────────────────────────────────────────
// `db` is a parameter: the scripts hand in the client they opened AFTER the
// DATABASE_URL gate, the tests hand in a fake that reads the predicates back.
// Every clause is a Drizzle expression — no raw SQL.

export type AddressDb = Pick<
  PostgresJsDatabase<typeof schema>,
  "select" | "delete" | "transaction"
>;

// The reach of an address — the SAME predicates the account erasure applies to
// the account's own (lowercased) address, lib/erase-user.ts. A test renders
// both and compares them, so the two paths cannot drift apart.
const remindersAt = (address: string) => eq(showReminders.email, address);
const ideasAt = (address: string) => eq(ideaSubmissions.email, address);
// users.email is Clerk's address as typed — compared case-insensitively.
const accountsAt = (address: string) =>
  eq(sql<string>`lower(${users.email})`, address);

export type AddressRows = {
  show_reminders: ShowReminder[];
  idea_submissions: IdeaSubmission[];
};

export type AddressRowIds = Record<AddressTable, string[]>;

/** Ids of the accounts whose address this is, in any letter case. */
export async function findAccountIds(
  db: AddressDb,
  address: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(accountsAt(address));
  return rows.map((row) => row.id);
}

export async function loadAddressRows(
  db: AddressDb,
  address: string,
): Promise<AddressRows> {
  return {
    show_reminders: await db
      .select()
      .from(showReminders)
      .where(remindersAt(address)),
    idea_submissions: await db
      .select()
      .from(ideaSubmissions)
      .where(ideasAt(address)),
  };
}

/** What `--apply` would delete — ids only, nothing else is read. */
export async function findAddressRowIds(
  db: AddressDb,
  address: string,
): Promise<AddressRowIds> {
  const reminders = await db
    .select({ id: showReminders.id })
    .from(showReminders)
    .where(remindersAt(address));
  const ideas = await db
    .select({ id: ideaSubmissions.id })
    .from(ideaSubmissions)
    .where(ideasAt(address));
  return {
    show_reminders: reminders.map((row) => row.id),
    idea_submissions: ideas.map((row) => row.id),
  };
}

/**
 * Both DELETEs in one transaction, by the same predicates the dry run reads
 * by. Idempotent: a second run finds nothing and says so.
 */
export async function eraseAddressRows(
  db: AddressDb,
  address: string,
): Promise<AddressRowIds> {
  return db.transaction(async (tx) => {
    const reminders = await tx
      .delete(showReminders)
      .where(remindersAt(address))
      .returning({ id: showReminders.id });
    const ideas = await tx
      .delete(ideaSubmissions)
      .where(ideasAt(address))
      .returning({ id: ideaSubmissions.id });
    return {
      show_reminders: reminders.map((row) => row.id),
      idea_submissions: ideas.map((row) => row.id),
    };
  });
}

// ── The export document ─────────────────────────────────────────────────

export type AddressExport = {
  exportedAt: string;
  /** The reference, never the address (the rows carry it, as stored). */
  subject: { addressRef: string };
  database: {
    /** `userId` is left out — see the note it produces. */
    show_reminders: Omit<ShowReminder, "userId">[];
    idea_submissions: IdeaSubmission[];
  };
  notes: string[];
};

export function assembleAddressExport(input: {
  address: string;
  rows: AddressRows;
  /** Injectable clock for a stable `exportedAt` in tests. */
  now?: Date;
}): AddressExport {
  const { address, rows } = input;
  const notes: string[] = [];

  // A reminder's `user_id` is a coalesce-backfill: it names the account that
  // was signed in when the row was written, not necessarily this subject —
  // with no account on this address it points at somebody else. Another
  // person's identifier is not an answer to this person's request (art.
  // 15(4)), and the runbook's manual path removes it too.
  let omitted = 0;
  const show_reminders = rows.show_reminders.map(({ userId, ...rest }) => {
    if (userId !== null) omitted += 1;
    return rest;
  });
  if (omitted > 0) {
    notes.push(
      `show_reminders: user_id left out of ${omitted} row(s) — it names an account under another address, not this subject's data (art. 15(4))`,
    );
  }

  return {
    exportedAt: (input.now ?? new Date()).toISOString(),
    subject: { addressRef: addressRef(address) },
    database: { show_reminders, idea_submissions: rows.idea_submissions },
    notes,
  };
}

// ── Operator output ─────────────────────────────────────────────────────
// Counts, ids and the reference — never a row, never a field. The log audit
// pins it with rows seeded full of markers.

export function summarizeAddressExport(result: AddressExport): string {
  const counts = ADDRESS_TABLES.map(
    (table) => `${table}=${result.database[table].length}`,
  ).join(" ");
  const lines = [
    `subject: address#${result.subject.addressRef} (the address itself is never printed)`,
    `database rows: ${counts}`,
  ];
  if (result.notes.length > 0) {
    lines.push(`notes (${result.notes.length}):`);
    for (const note of result.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

/** `would delete: a=1 b=0` plus one `ids …` line per table that has any. */
export function summarizeAddressRowIds(
  verb: "would delete" | "deleted",
  ids: AddressRowIds,
): string {
  const lines = [
    `${verb}: ${ADDRESS_TABLES.map((table) => `${table}=${ids[table].length}`).join(" ")}`,
  ];
  for (const table of ADDRESS_TABLES) {
    if (ids[table].length > 0) {
      lines.push(`ids ${table}: ${ids[table].join(", ")}`);
    }
  }
  return lines.join("\n");
}

/** The refusal: the account's id, the tool that serves it, nothing else. */
export function refusalMessage(
  command: "export" | "erase",
  accountIds: readonly string[],
): string {
  const next =
    command === "export"
      ? "pnpm export-user-data <id> — its answer is complete: the account's own tables plus these two, and the vendors (runbook §3)"
      : "pnpm erase-user <id> — the account is erased through its own path, these two tables included (runbook §4)";
  return [
    `refused: this address belongs to an account (${accountIds.join(", ")}) — no row of the two tables was read or changed.`,
    `  use ${next}`,
  ].join("\n");
}

// ── CLI arguments ───────────────────────────────────────────────────────
// No message below ever carries the argument it refuses: a refused
// positional may be an address, and stderr is a log.

export const EXPORT_EMAIL_USAGE =
  "usage: DATABASE_URL=<host> pnpm -s export-email <address> [--out <file>]\n" +
  "  address — the requester's email, any letter case; for an address WITHOUT an account (an account is refused — use export-user-data)\n" +
  "  --out   — where to write the JSON (default: the OS temp dir, export-address-<hash>-<YYYY-MM-DD>.json — outside the repo, the path is printed; mode 0600)\n" +
  "  Covers show_reminders and idea_submissions. Nothing is read from .env.local on purpose — DATABASE_URL is passed explicitly.";

export const ERASE_EMAIL_USAGE =
  "usage: DATABASE_URL=<host> pnpm -s erase-email <address> [--apply]\n" +
  "  address — the requester's email, any letter case; for an address WITHOUT an account (an account is refused — use erase-user)\n" +
  "  --apply — delete show_reminders and idea_submissions rows of the address in one transaction (default: a dry run — ids and counts, nothing written)\n" +
  "  Nothing is read from .env.local on purpose — DATABASE_URL is passed explicitly.";

export type ArgFailure = {
  ok: false;
  reason:
    | "missing_address"
    | "invalid_address"
    | "missing_out_value"
    | "unknown_argument";
  message: string;
};

type ParsedArgs =
  | { ok: true; address: string; out: string | null; apply: boolean }
  | ArgFailure;

function parseArgs(
  argv: readonly string[],
  allow: { out: boolean; apply: boolean },
): ParsedArgs {
  let raw: string | null = null;
  let out: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (allow.out && arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        return { ok: false, reason: "missing_out_value", message: "--out needs a file path" };
      }
      out = value;
      i += 1;
    } else if (allow.out && arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) {
        return { ok: false, reason: "missing_out_value", message: "--out needs a file path" };
      }
      out = value;
    } else if (allow.apply && arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("-")) {
      return {
        ok: false,
        reason: "unknown_argument",
        message: `unknown option${arg.includes("@") ? "" : `: ${arg}`}`,
      };
    } else if (raw !== null) {
      return {
        ok: false,
        reason: "unknown_argument",
        message: "unexpected extra argument — one address per run",
      };
    } else {
      raw = arg;
    }
  }
  if (raw === null) {
    return { ok: false, reason: "missing_address", message: "missing <address>" };
  }
  const address = normalizeAddress(raw);
  if (!isAddressShape(address)) {
    return {
      ok: false,
      reason: "invalid_address",
      message: "<address> does not look like an email address",
    };
  }
  return { ok: true, address, out, apply };
}

export type ParsedExportEmailArgs =
  | { ok: true; address: string; out: string | null }
  | ArgFailure;

export function parseExportEmailArgs(
  argv: readonly string[],
): ParsedExportEmailArgs {
  const parsed = parseArgs(argv, { out: true, apply: false });
  return parsed.ok
    ? { ok: true, address: parsed.address, out: parsed.out }
    : parsed;
}

export type ParsedEraseEmailArgs =
  | { ok: true; address: string; apply: boolean }
  | ArgFailure;

export function parseEraseEmailArgs(
  argv: readonly string[],
): ParsedEraseEmailArgs {
  const parsed = parseArgs(argv, { out: false, apply: true });
  return parsed.ok
    ? { ok: true, address: parsed.address, apply: parsed.apply }
    : parsed;
}

/**
 * `dir` is the OS temp dir in the script, never the working directory: the
 * default must not land inside the repository, where a routine `git add -A`
 * would stage a person's record (.gitignore covers `export-*.json` too). The
 * name carries the reference, not the address.
 */
export function defaultAddressExportPath(
  address: string,
  now: Date,
  dir: string,
): string {
  return join(
    dir,
    `export-address-${addressRef(address)}-${now.toISOString().slice(0, 10)}.json`,
  );
}

/** mode applies on creation only; the chmod makes 0600 true on overwrite. */
export function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// ── The two commands ────────────────────────────────────────────────────

export type CommandIo = {
  out(line: string): void;
  err(line: string): void;
};

/** `process.env` in the scripts, a literal in the tests. */
export type CommandEnv = Readonly<Record<string, string | undefined>>;

export type CommandDeps = {
  /** Opens the database — called only once the arguments and DATABASE_URL passed. */
  getDb: () => Promise<AddressDb>;
  io: CommandIo;
  /** Injectable clock. */
  now?: Date;
};

export type ExportCommandDeps = CommandDeps & {
  /** The OS temp dir — where the default file goes. */
  tmpDir: string;
  writeFile: (path: string, content: string) => void;
};

function missingDatabaseMessage(usage: string): string {
  return (
    "DATABASE_URL must be passed explicitly (this script does not read .env.local on purpose):\n" +
    `  ${usage.split("\n")[0].replace("usage: ", "")}`
  );
}

/**
 * `pnpm -s export-email` — exit 2 bad arguments / no DATABASE_URL, 4 the
 * address belongs to an account, 1 the database or the file write failed,
 * 0 the file is written.
 */
export async function runExportEmail(
  argv: readonly string[],
  env: CommandEnv,
  deps: ExportCommandDeps,
): Promise<number> {
  const { io } = deps;
  const parsed = parseExportEmailArgs(argv);
  if (!parsed.ok) {
    io.err(`${parsed.message}\n\n${EXPORT_EMAIL_USAGE}`);
    return EXIT_USAGE;
  }
  if (!env.DATABASE_URL) {
    io.err(missingDatabaseMessage(EXPORT_EMAIL_USAGE));
    return EXIT_USAGE;
  }

  const { address } = parsed;
  const now = deps.now ?? new Date();
  const outPath =
    parsed.out ?? defaultAddressExportPath(address, now, deps.tmpDir);

  try {
    const db = await deps.getDb();
    const accounts = await findAccountIds(db, address);
    if (accounts.length > 0) {
      io.err(refusalMessage("export", accounts));
      return EXIT_REFUSED;
    }

    const rows = await loadAddressRows(db, address);
    const result = assembleAddressExport({ address, rows, now });
    deps.writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);

    io.out(summarizeAddressExport(result));
    // A path the operator chose may name the address; stdout must not.
    const shown = outPath.toLowerCase().includes(address)
      ? "<path elided: it contains the address>"
      : outPath;
    io.out(`written ${shown} (mode 0600) — delete it once the reply has gone out`);
    return EXIT_OK;
  } catch (err) {
    // Never the message: the postgres driver quotes the statement, and the
    // statement carries the address.
    io.err(`export-email failed (${failureLabel(err)})`);
    return EXIT_FAILED;
  }
}

/**
 * `pnpm -s erase-email` — dry run unless `--apply`. Exit 2 bad arguments / no
 * DATABASE_URL, 4 the address belongs to an account, 1 the database failed
 * (re-run: it converges), 0 done.
 */
export async function runEraseEmail(
  argv: readonly string[],
  env: CommandEnv,
  deps: CommandDeps,
): Promise<number> {
  const { io } = deps;
  const parsed = parseEraseEmailArgs(argv);
  if (!parsed.ok) {
    io.err(`${parsed.message}\n\n${ERASE_EMAIL_USAGE}`);
    return EXIT_USAGE;
  }
  if (!env.DATABASE_URL) {
    io.err(missingDatabaseMessage(ERASE_EMAIL_USAGE));
    return EXIT_USAGE;
  }

  const { address, apply } = parsed;
  try {
    const db = await deps.getDb();
    io.out(`${apply ? "APPLY" : "DRY RUN"} — erase ${subjectLabel(address)}`);

    const accounts = await findAccountIds(db, address);
    if (accounts.length > 0) {
      io.err(refusalMessage("erase", accounts));
      return EXIT_REFUSED;
    }
    io.out("account: none for this address");

    if (!apply) {
      io.out(summarizeAddressRowIds("would delete", await findAddressRowIds(db, address)));
      io.out("nothing changed (dry run — re-run with --apply)");
      return EXIT_OK;
    }

    const erased = await eraseAddressRows(db, address);
    io.out(summarizeAddressRowIds("deleted", erased));
    if (erased.idea_submissions.length > 0) {
      io.out(
        "record the idea ids in the request register (runbook §6) — db-restore.md §7 repeats the deletion from them after a restore",
      );
    }
    return EXIT_OK;
  } catch (err) {
    io.err(`erase-email failed (${failureLabel(err)})`);
    return EXIT_FAILED;
  }
}
