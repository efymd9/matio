import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addressRef,
  assembleAddressExport,
  defaultAddressExportPath,
  EXIT_FAILED,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_USAGE,
  findAddressRowIds,
  isAddressShape,
  normalizeAddress,
  parseEraseEmailArgs,
  parseExportEmailArgs,
  runEraseEmail,
  runExportEmail,
  summarizeAddressExport,
  summarizeAddressRowIds,
  writePrivateFile,
  type AddressDb,
  type AddressRows,
} from "./address-requests";
import { previewErasure, type EraseDb } from "./erase-user";

// erase-user.ts reports to Sentry on its failure paths; the predicate
// cross-check below never reaches one — the mock only keeps the SDK out.
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

// `pnpm export-email` / `pnpm erase-email` (#339). The commands run here
// against a STATEFUL fake database: it renders every Drizzle clause through
// the real Postgres dialect and filters its tables by what the clause says,
// so «finds the rows», «deletes exactly the found rows» and «the transaction
// rolls back» are proven by what is left in the tables, not by a mock that
// agrees with the code. The log audit (lib/log-audit.test.ts) has the
// privacy half — what the commands print — with markers in the rows.

const MIXED = "Ana.Perez@Example.com";
const ADDRESS = "ana.perez@example.com";
// First 8 hex digits of sha256(ADDRESS) — what the runbook's one-liner prints
// (`printf '%s' 'Ana.Perez@Example.com' | tr 'A-Z' 'a-z' | shasum -a 256 | cut -c1-8`).
const REF = "3c6c5c25";

type Row = Record<string, unknown>;

/** The tables as the capture paths leave them: addresses lowercased. */
function seed() {
  return {
    show_reminders: [
      { id: "rem_anon", email: ADDRESS, userId: null, locale: "es" },
      { id: "rem_linked", email: ADDRESS, userId: "user_2other", locale: "en" },
      { id: "rem_else", email: "someone.else@example.invalid", userId: null, locale: "en" },
    ] as Row[],
    idea_submissions: [
      { id: "idea_mine", email: ADDRESS, authorName: "Ana", story: "A postman." },
      { id: "idea_else", email: "someone.else@example.invalid", authorName: "Else", story: "Another." },
    ] as Row[],
    users: [] as Row[],
  };
}

type Tables = ReturnType<typeof seed>;

/**
 * A fake of the three Drizzle entry points the commands use. Understands
 * exactly the clauses the module builds — one equality on a column, or on
 * `lower(column)` — and refuses anything else loudly, so a changed predicate
 * fails here instead of silently matching nothing.
 */
function fakeDb(tables: Tables) {
  const dialect = new PgDialect();
  const log: string[] = [];
  let failDelete: string | undefined;

  function keep(table: PgTable, clause: SQL): (row: Row) => boolean {
    const q = dialect.sqlToQuery(clause);
    const m = /^(lower\()?"(\w+)"\."(\w+)"\)? = \$1$/.exec(q.sql);
    if (!m || m[2] !== getTableName(table)) {
      throw new Error(`the fake does not understand: ${q.sql}`);
    }
    // SQL column name → the key Drizzle returns it under.
    const field = Object.entries(getTableColumns(table)).find(
      ([, column]) => column.name === m[3],
    )?.[0];
    if (!field) throw new Error(`no column ${m[3]}`);
    return (row) => {
      const value = row[field];
      return (m[1] && typeof value === "string" ? value.toLowerCase() : value) === q.params[0];
    };
  }

  const pick = (row: Row, fields?: Record<string, unknown>) =>
    fields ? Object.fromEntries(Object.keys(fields).map((k) => [k, row[k]])) : { ...row };

  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: PgTable) => ({
        where: async (clause: SQL) => {
          const name = getTableName(table) as keyof Tables;
          log.push(`select ${name}`);
          return tables[name].filter(keep(table, clause)).map((row) => pick(row, fields));
        },
      }),
    }),
    delete: (table: PgTable) => ({
      where: (clause: SQL) => ({
        returning: async (fields: Record<string, unknown>) => {
          const name = getTableName(table) as keyof Tables;
          log.push(`delete ${name}`);
          if (failDelete === name) {
            throw Object.assign(new Error(`Failed query: delete from "${name}" where email = '${ADDRESS}'`), {
              name: "DrizzleQueryError",
              cause: Object.assign(new Error(`deadlock detected, row for ${ADDRESS}`), {
                name: "PostgresError",
                code: "40P01",
              }),
            });
          }
          const match = keep(table, clause);
          const gone = tables[name].filter(match);
          tables[name] = tables[name].filter((row) => !match(row));
          return gone.map((row) => pick(row, fields));
        },
      }),
    }),
    // A real transaction rolls back on a throw; the fake does the same with
    // a snapshot, which is what lets a test see atomicity from the outside.
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone(tables);
      log.push("begin");
      try {
        const result = await fn(db);
        log.push("commit");
        return result;
      } catch (err) {
        Object.assign(tables, snapshot);
        log.push("rollback");
        throw err;
      }
    },
  };
  return {
    db: db as unknown as AddressDb,
    log,
    failDeleteOn(table: string) {
      failDelete = table;
    },
  };
}

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
  };
}

const ENV = { DATABASE_URL: "postgres://invalid.example.invalid/matio" };
const NOW = new Date("2026-10-03T12:00:00Z");

// ── the address ─────────────────────────────────────────────────────────

describe("the address", () => {
  it("is trimmed and lowercased — the form both tables store it in", () => {
    expect(normalizeAddress(`  ${MIXED}\n`)).toBe(ADDRESS);
  });

  it("must have one @ with something on both sides and no whitespace", () => {
    for (const ok of [ADDRESS, "a@b", "x+tag@sub.example.invalid"]) {
      expect(isAddressShape(ok), ok).toBe(true);
    }
    for (const bad of ["", "ana", "@example.invalid", "ana@", "a@@b", "a@b@c", "ana perez@example.invalid", `${"a".repeat(250)}@b.cc`]) {
      expect(isAddressShape(bad), bad).toBe(false);
    }
  });

  it("is referred to by the same 8 hex digits the runbook's register hash prints", () => {
    expect(addressRef(MIXED)).toBe(REF);
    expect(addressRef(ADDRESS)).toBe(REF);
  });
});

// ── arguments ───────────────────────────────────────────────────────────

describe("parseExportEmailArgs", () => {
  it("takes the address in any case, normalised, and an optional --out in either spelling", () => {
    expect(parseExportEmailArgs([MIXED])).toEqual({ ok: true, address: ADDRESS, out: null });
    expect(parseExportEmailArgs([MIXED, "--out", "/tmp/a.json"])).toEqual({ ok: true, address: ADDRESS, out: "/tmp/a.json" });
    expect(parseExportEmailArgs(["--out=/tmp/a.json", MIXED])).toEqual({ ok: true, address: ADDRESS, out: "/tmp/a.json" });
  });

  it("refuses a missing address, a non-address, a dangling --out and an unknown flag — and --apply, which belongs to the other command", () => {
    expect(parseExportEmailArgs([])).toMatchObject({ ok: false, reason: "missing_address" });
    expect(parseExportEmailArgs(["ana perez"])).toMatchObject({ ok: false, reason: "invalid_address" });
    expect(parseExportEmailArgs([MIXED, "--out"])).toMatchObject({ ok: false, reason: "missing_out_value" });
    expect(parseExportEmailArgs([MIXED, "--out="])).toMatchObject({ ok: false, reason: "missing_out_value" });
    expect(parseExportEmailArgs([MIXED, "--bogus"])).toMatchObject({ ok: false, reason: "unknown_argument", message: "unknown option: --bogus" });
    expect(parseExportEmailArgs([MIXED, "--apply"])).toMatchObject({ ok: false, reason: "unknown_argument" });
  });

  it("never carries the argument it refuses — a refused positional may be an address", () => {
    const second = parseExportEmailArgs([MIXED, "other.person@example.invalid"]);
    expect(second).toMatchObject({ ok: false, reason: "unknown_argument" });
    const refused = [
      second,
      parseExportEmailArgs(["not an address@example.invalid"]),
      parseExportEmailArgs(["-x@example.invalid"]),
    ];
    for (const r of refused) {
      expect(r.ok).toBe(false);
      const message = r.ok ? "" : r.message;
      expect(message).not.toContain("example.invalid");
      expect(message).not.toContain("other.person");
    }
  });
});

describe("parseEraseEmailArgs", () => {
  it("is a dry run unless --apply, in any position", () => {
    expect(parseEraseEmailArgs([MIXED])).toEqual({ ok: true, address: ADDRESS, apply: false });
    expect(parseEraseEmailArgs([MIXED, "--apply"])).toEqual({ ok: true, address: ADDRESS, apply: true });
    expect(parseEraseEmailArgs(["--apply", MIXED])).toEqual({ ok: true, address: ADDRESS, apply: true });
  });

  it("refuses what the export takes (--out), a second address and a non-address", () => {
    expect(parseEraseEmailArgs([MIXED, "--out", "x"])).toMatchObject({ ok: false, reason: "unknown_argument" });
    expect(parseEraseEmailArgs([MIXED, "other.person@example.invalid"])).toMatchObject({ ok: false, reason: "unknown_argument" });
    expect(parseEraseEmailArgs(["--apply"])).toMatchObject({ ok: false, reason: "missing_address" });
    expect(parseEraseEmailArgs(["nope", "--apply"])).toMatchObject({ ok: false, reason: "invalid_address" });
  });
});

describe("defaultAddressExportPath", () => {
  it("names the file after the reference and the day, inside the directory it is given — the address is not in it", () => {
    const path = defaultAddressExportPath(MIXED, NOW, "/tmp/dir");
    expect(path).toBe(`/tmp/dir/export-address-${REF}-2026-10-03.json`);
    expect(path).not.toContain("ana");
  });
});

// ── the document ────────────────────────────────────────────────────────

describe("assembleAddressExport", () => {
  const rows = (reminders: Row[], ideas: Row[] = []) =>
    ({ show_reminders: reminders, idea_submissions: ideas }) as unknown as AddressRows;

  it("lists both tables as keys even with zero rows, keys the subject by the reference and nothing else", () => {
    const doc = assembleAddressExport({ address: ADDRESS, rows: rows([]), now: NOW });
    expect(doc).toEqual({
      exportedAt: "2026-10-03T12:00:00.000Z",
      subject: { addressRef: REF },
      database: { show_reminders: [], idea_submissions: [] },
      notes: [],
    });
  });

  it("leaves another account's id out of a reminder row and says how many it did — art. 15(4)", () => {
    const doc = assembleAddressExport({
      address: ADDRESS,
      rows: rows([
        { id: "rem_anon", email: ADDRESS, userId: null },
        { id: "rem_linked", email: ADDRESS, userId: "user_2other" },
        { id: "rem_linked2", email: ADDRESS, userId: "user_2third" },
      ]),
      now: NOW,
    });
    expect(doc.database.show_reminders).toEqual([
      { id: "rem_anon", email: ADDRESS },
      { id: "rem_linked", email: ADDRESS },
      { id: "rem_linked2", email: ADDRESS },
    ]);
    expect(JSON.stringify(doc)).not.toContain("user_2");
    expect(doc.notes).toEqual([
      "show_reminders: user_id left out of 2 row(s) — it names an account under another address, not this subject's data (art. 15(4))",
    ]);
  });

  it("gives the idea rows as stored — the pitch is the subject's own words", () => {
    const idea = { id: "idea_mine", email: ADDRESS, authorName: "Ana", story: "A postman." };
    const doc = assembleAddressExport({ address: ADDRESS, rows: rows([], [idea]), now: NOW });
    expect(doc.database.idea_submissions).toEqual([idea]);
  });

  it("summarises by counts and the reference — never a row", () => {
    const doc = assembleAddressExport({
      address: ADDRESS,
      rows: rows([{ id: "r", email: ADDRESS, userId: "user_2other" }], [{ id: "i", email: ADDRESS, story: "A postman." }]),
      now: NOW,
    });
    const text = summarizeAddressExport(doc);
    expect(text).toBe(
      [
        `subject: address#${REF} (the address itself is never printed)`,
        "database rows: show_reminders=1 idea_submissions=1",
        "notes (1):",
        "  - show_reminders: user_id left out of 1 row(s) — it names an account under another address, not this subject's data (art. 15(4))",
      ].join("\n"),
    );
    expect(text).not.toContain(ADDRESS);
    expect(text).not.toContain("postman");
  });
});

describe("summarizeAddressRowIds", () => {
  it("prints counts, and an ids line only for a table that has any", () => {
    expect(summarizeAddressRowIds("would delete", { show_reminders: ["a", "b"], idea_submissions: [] })).toBe(
      "would delete: show_reminders=2 idea_submissions=0\nids show_reminders: a, b",
    );
    expect(summarizeAddressRowIds("deleted", { show_reminders: [], idea_submissions: [] })).toBe(
      "deleted: show_reminders=0 idea_submissions=0",
    );
  });
});

// ── export-email ────────────────────────────────────────────────────────

describe("runExportEmail", () => {
  const writeFile = vi.fn<(path: string, content: string) => void>();
  const deps = (db: AddressDb, sink: ReturnType<typeof io>) => ({
    getDb: async () => db,
    io: sink.io,
    now: NOW,
    tmpDir: "/tmp/dir",
    writeFile,
  });

  beforeEach(() => writeFile.mockReset());

  it("an address in mixed case finds the rows of BOTH tables — and only those", async () => {
    const { db } = fakeDb(seed());
    const sink = io();

    const code = await runExportEmail([MIXED], ENV, deps(db, sink));

    expect(code).toBe(EXIT_OK);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0];
    expect(path).toBe(`/tmp/dir/export-address-${REF}-2026-10-03.json`);
    const doc = JSON.parse(content);
    expect(doc.database.show_reminders.map((r: Row) => r.id)).toEqual(["rem_anon", "rem_linked"]);
    expect(doc.database.idea_submissions.map((r: Row) => r.id)).toEqual(["idea_mine"]);
    // The other address's rows are not in the person's file.
    expect(content).not.toContain("someone.else");
    // Stdout: counts, the reference and the path — not a value.
    expect(sink.out.join("\n")).toBe(
      [
        `subject: address#${REF} (the address itself is never printed)`,
        "database rows: show_reminders=2 idea_submissions=1",
        "notes (1):",
        "  - show_reminders: user_id left out of 1 row(s) — it names an account under another address, not this subject's data (art. 15(4))",
        `written /tmp/dir/export-address-${REF}-2026-10-03.json (mode 0600) — delete it once the reply has gone out`,
      ].join("\n"),
    );
    expect(sink.err).toEqual([]);
  });

  it("reads nothing at all for an address that belongs to an account — refuses, names the id, points at export-user-data, writes no file", async () => {
    const tables = seed();
    // Clerk's address as typed; the account's check is case-insensitive.
    tables.users.push({ id: "user_2ana", email: MIXED });
    const { db, log } = fakeDb(tables);
    const sink = io();

    const code = await runExportEmail([ADDRESS], ENV, deps(db, sink));

    expect(code).toBe(EXIT_REFUSED);
    expect(sink.err.join("\n")).toContain("user_2ana");
    expect(sink.err.join("\n")).toContain("pnpm export-user-data <id>");
    expect(sink.err.join("\n")).not.toContain(ADDRESS);
    expect(sink.out).toEqual([]);
    expect(writeFile).not.toHaveBeenCalled();
    expect(log).toEqual(["select users"]);
  });

  it("without DATABASE_URL it exits 2 before opening anything", async () => {
    const getDb = vi.fn(async () => fakeDb(seed()).db);
    const sink = io();

    const code = await runExportEmail([MIXED], {}, { ...deps(fakeDb(seed()).db, sink), getDb });

    expect(code).toBe(EXIT_USAGE);
    expect(getDb).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(sink.err.join("\n")).toContain("DATABASE_URL must be passed explicitly");
    expect(sink.err.join("\n")).toContain("does not read .env.local");
    expect(sink.err.join("\n")).not.toContain(ADDRESS);
  });

  it("bad arguments exit 2 with the usage — before the environment is even looked at", async () => {
    const getDb = vi.fn(async () => fakeDb(seed()).db);
    const sink = io();

    expect(await runExportEmail([], {}, { ...deps(fakeDb(seed()).db, sink), getDb })).toBe(EXIT_USAGE);
    expect(sink.err.join("\n")).toContain("missing <address>");
    expect(sink.err.join("\n")).toContain("usage: DATABASE_URL=<host> pnpm export-email <address>");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("a database failure exits 1 and says class + SQLSTATE only", async () => {
    const failing = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw Object.assign(new Error(`Failed query: select … where email = '${ADDRESS}'`), {
              name: "DrizzleQueryError",
              cause: Object.assign(new Error(`connection for ${ADDRESS} lost`), { name: "PostgresError", code: "57P01" }),
            });
          },
        }),
      }),
    } as unknown as AddressDb;
    const sink = io();

    const code = await runExportEmail([MIXED], ENV, deps(failing, sink));

    expect(code).toBe(EXIT_FAILED);
    expect(sink.err).toEqual(["export-email failed (DrizzleQueryError/57P01)"]);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("a failure with no SQLSTATE is named by class alone — the message is never read", async () => {
    const failing = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw new Error(`connect ECONNREFUSED for ${ADDRESS}`);
          },
        }),
      }),
    } as unknown as AddressDb;
    const sink = io();

    expect(await runExportEmail([MIXED], ENV, deps(failing, sink))).toBe(EXIT_FAILED);
    expect(sink.err).toEqual(["export-email failed (Error)"]);
  });

  it("a file the operator names after the address is not echoed on stdout", async () => {
    const { db } = fakeDb(seed());
    const sink = io();

    const code = await runExportEmail([MIXED, "--out", `/tmp/dsr/${ADDRESS}.json`], ENV, deps(db, sink));

    expect(code).toBe(EXIT_OK);
    expect(writeFile.mock.calls[0][0]).toBe(`/tmp/dsr/${ADDRESS}.json`);
    expect(sink.out.join("\n")).not.toContain(ADDRESS);
    expect(sink.out.at(-1)).toBe("written <path elided: it contains the address> (mode 0600) — delete it once the reply has gone out");
  });
});

describe("writePrivateFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "address-requests-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates the file with mode 0600 and writes the content", () => {
    const path = join(dir, "new.json");
    writePrivateFile(path, "{}\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("{}\n");
  });

  it("makes 0600 true on an existing, more open file too", () => {
    const path = join(dir, "old.json");
    writeFileSync(path, "stale", { mode: 0o644 });
    expect(statSync(path).mode & 0o777).toBe(0o644);
    writePrivateFile(path, "fresh");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("fresh");
  });
});

// ── erase-email ─────────────────────────────────────────────────────────

describe("runEraseEmail", () => {
  const deps = (db: AddressDb, sink: ReturnType<typeof io>) => ({
    getDb: async () => db,
    io: sink.io,
  });

  it("is a dry run by default: counts and ids of the rows of both tables, and nothing deleted — no transaction, no DELETE", async () => {
    const tables = seed();
    const before = structuredClone(tables);
    const { db, log } = fakeDb(tables);
    const sink = io();

    const code = await runEraseEmail([MIXED], ENV, deps(db, sink));

    expect(code).toBe(EXIT_OK);
    expect(tables).toEqual(before);
    expect(log.filter((entry) => entry.startsWith("delete") || entry === "begin")).toEqual([]);
    expect(sink.out).toEqual([
      `DRY RUN — erase address#${REF}`,
      "account: none for this address",
      "would delete: show_reminders=2 idea_submissions=1\nids show_reminders: rem_anon, rem_linked\nids idea_submissions: idea_mine",
      "nothing changed (dry run — re-run with --apply)",
    ]);
    expect(sink.err).toEqual([]);
  });

  it("--apply deletes exactly what the dry run found, in one transaction, and leaves every other address's rows", async () => {
    const tables = seed();
    const { db, log } = fakeDb(tables);
    const dry = io();
    await runEraseEmail([MIXED], ENV, deps(db, dry));
    log.length = 0;
    const sink = io();

    const code = await runEraseEmail([MIXED, "--apply"], ENV, deps(db, sink));

    expect(code).toBe(EXIT_OK);
    // The account check, then both DELETEs between one begin and one commit.
    expect(log).toEqual(["select users", "begin", "delete show_reminders", "delete idea_submissions", "commit"]);
    expect(tables.show_reminders.map((r) => r.id)).toEqual(["rem_else"]);
    expect(tables.idea_submissions.map((r) => r.id)).toEqual(["idea_else"]);
    // The ids it reports are the ids the dry run promised.
    expect(dry.out[2]).toBe(
      "would delete: show_reminders=2 idea_submissions=1\nids show_reminders: rem_anon, rem_linked\nids idea_submissions: idea_mine",
    );
    expect(sink.out[0]).toBe(`APPLY — erase address#${REF}`);
    expect(sink.out[2]).toBe(
      "deleted: show_reminders=2 idea_submissions=1\nids show_reminders: rem_anon, rem_linked\nids idea_submissions: idea_mine",
    );
    // Idea ids are what the request register keeps for a restore (runbook §6).
    expect(sink.out[3]).toContain("record the idea ids in the request register");
  });

  it("--apply twice is safe: the second run finds nothing and changes nothing", async () => {
    const tables = seed();
    const { db } = fakeDb(tables);
    await runEraseEmail([MIXED, "--apply"], ENV, deps(db, io()));
    const afterFirst = structuredClone(tables);
    const sink = io();

    const code = await runEraseEmail([MIXED, "--apply"], ENV, deps(db, sink));

    expect(code).toBe(EXIT_OK);
    expect(tables).toEqual(afterFirst);
    expect(sink.out.slice(2)).toEqual(["deleted: show_reminders=0 idea_submissions=0"]);
  });

  it("a failure between the two DELETEs rolls the first back — the address is never half erased", async () => {
    const tables = seed();
    const before = structuredClone(tables);
    const { db, log, failDeleteOn } = fakeDb(tables);
    failDeleteOn("idea_submissions");
    const sink = io();

    const code = await runEraseEmail([MIXED, "--apply"], ENV, deps(db, sink));

    expect(code).toBe(EXIT_FAILED);
    expect(log).toEqual(["select users", "begin", "delete show_reminders", "delete idea_submissions", "rollback"]);
    expect(tables).toEqual(before);
    expect(sink.err).toEqual(["erase-email failed (DrizzleQueryError/40P01)"]);
  });

  it("refuses an address that belongs to an account — names the id, points at erase-user, writes nothing (dry run and --apply alike)", async () => {
    for (const args of [[MIXED], [MIXED, "--apply"]]) {
      const tables = seed();
      tables.users.push({ id: "user_2ana", email: "ANA.PEREZ@EXAMPLE.COM" });
      const before = structuredClone(tables);
      const { db, log } = fakeDb(tables);
      const sink = io();

      const code = await runEraseEmail(args, ENV, deps(db, sink));

      expect(code, args.join(" ")).toBe(EXIT_REFUSED);
      expect(sink.err.join("\n")).toContain("user_2ana");
      expect(sink.err.join("\n")).toContain("pnpm erase-user <id>");
      expect(sink.err.join("\n")).not.toContain(ADDRESS);
      expect(tables).toEqual(before);
      expect(log).toEqual(["select users"]);
    }
  });

  it("without DATABASE_URL it exits 2 before opening anything", async () => {
    const getDb = vi.fn(async () => fakeDb(seed()).db);
    const sink = io();

    const code = await runEraseEmail([MIXED, "--apply"], { DATABASE_URL: "" }, { getDb, io: sink.io });

    expect(code).toBe(EXIT_USAGE);
    expect(getDb).not.toHaveBeenCalled();
    expect(sink.err.join("\n")).toContain("DATABASE_URL must be passed explicitly");
    expect(sink.out).toEqual([]);
  });

  it("bad arguments exit 2 with the usage", async () => {
    const getDb = vi.fn(async () => fakeDb(seed()).db);
    const sink = io();

    expect(await runEraseEmail(["not-an-address"], ENV, { getDb, io: sink.io })).toBe(EXIT_USAGE);
    expect(sink.err.join("\n")).toContain("usage: DATABASE_URL=<host> pnpm erase-email <address> [--apply]");
    expect(getDb).not.toHaveBeenCalled();
  });
});

// ── the reach of an address is the account erasure's reach ──────────────

describe("the by-address predicates match the account erasure's own (lib/erase-user.ts)", () => {
  /** `"table"."col" = $n` read back as sorted `col=value` pairs. */
  function equalitiesOf(table: string, q: { sql: string; params: unknown[] }) {
    const pairs: string[] = [];
    for (const m of q.sql.matchAll(new RegExp(`"${table}"\\."(\\w+)" = \\$(\\d+)`, "g"))) {
      pairs.push(`${m[1]}=${String(q.params[Number(m[2]) - 1])}`);
    }
    return pairs.sort();
  }

  it("for show_reminders the address half, for idea_submissions the whole predicate — same column, same lowercased value", async () => {
    const dialect = new PgDialect();
    const wheres: { table: string; q: { sql: string; params: unknown[] } }[] = [];
    const erasure = {
      select: () => ({
        from: (table: PgTable) => ({
          where: (clause: SQL) => {
            const name = getTableName(table);
            wheres.push({ table: name, q: dialect.sqlToQuery(clause) });
            return Object.assign(Promise.resolve([{ n: 0 }]), {
              limit: async () => (name === "users" ? [{ email: MIXED, stripeCustomerId: null }] : []),
            });
          },
        }),
      }),
    } as unknown as EraseDb;
    await previewErasure("user_2ana", {
      db: erasure,
      getStripe: () => ({
        subscriptions: { update: vi.fn() },
        customers: { search: vi.fn(async () => ({ data: [], has_more: false })) },
      }),
      posthog: null,
    });

    // The address module, recorded on a fake that keeps the clause text.
    const mine: { table: string; q: { sql: string; params: unknown[] } }[] = [];
    const recorder = {
      select: () => ({
        from: (table: PgTable) => ({
          where: async (clause: SQL) => {
            mine.push({ table: getTableName(table), q: dialect.sqlToQuery(clause) });
            return [];
          },
        }),
      }),
    } as unknown as AddressDb;
    await findAddressRowIds(recorder, normalizeAddress(MIXED));

    const erased = (table: string) => equalitiesOf(table, wheres.find((w) => w.table === table)!.q);
    const found = (table: string) => equalitiesOf(table, mine.find((w) => w.table === table)!.q);
    expect(found("idea_submissions")).toEqual(erased("idea_submissions"));
    expect(found("show_reminders")).toEqual([`email=${ADDRESS}`]);
    expect(erased("show_reminders")).toContain(`email=${ADDRESS}`);
    expect(found("idea_submissions")).toEqual([`email=${ADDRESS}`]);
  });
});
