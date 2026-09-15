import { describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";

import type { User } from "@/db/schema";
import {
  assembleUserExport,
  CLERK_TIMEOUT_MS,
  defaultExportPath,
  errorLabel,
  EXPORT_TABLES,
  STRIPE_TIMEOUT_MS,
  parseExportArgs,
  POSTHOG_EVENTS_LIMIT,
  posthogEventsQuery,
  posthogPersonQuery,
  summarizeExport,
  type ClerkClientLike,
  type PosthogClientLike,
  type StripeClientLike,
  type StripeInvoiceLike,
  type UserExportRows,
} from "./user-export";
import { loadUserExportRows, type ExportDb } from "./user-export-db";

// The art. 15/20 export. Three things are under test: the SHAPE of the
// document (which tables, which vendors, what happens when one is missing),
// the KEYS the database half reads by (a Drizzle clause rendered to SQL and
// read — a filter is only proven by looking at it), and the operator
// summary (counts, never values — the log audit has the marker version).

const USER_ID = "user_2subject";
const NOW = new Date("2026-09-07T12:00:00Z");

const account: User = {
  id: USER_ID,
  email: "subject@example.invalid",
  role: "user",
  stripeCustomerId: "cus_subject",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  signupOrigin: "clerk_signup",
  country: "ES",
  attributionFirstSource: "tiktok",
  attributionFirstMedium: null,
  attributionFirstCampaign: null,
  attributionLastSource: null,
  attributionLastMedium: null,
  attributionLastCampaign: null,
};

function emptyRows(over: Partial<UserExportRows> = {}): UserExportRows {
  return {
    users: [],
    subscriptions: [],
    watch_progress: [],
    watch_days: [],
    trial_sessions: [],
    visitors: [],
    visitor_days: [],
    show_reminders: [],
    ...over,
  };
}

// ── (а) the document ────────────────────────────────────────────────────

describe("assembleUserExport · shape", () => {
  it("lists all eight tables as keys even with zero rows, and nothing else", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows(),
      clients: {},
      now: NOW,
    });

    expect(Object.keys(result.database)).toEqual([...EXPORT_TABLES]);
    for (const table of EXPORT_TABLES) expect(result.database[table]).toEqual([]);
    expect("stripe_events" in result.database).toBe(false);
    expect(result.exportedAt).toBe("2026-09-07T12:00:00.000Z");
    expect(result.subject).toEqual({ userId: USER_ID });
    expect(result.processors).toEqual({ clerk: null, stripe: null, posthog: null });
  });

  it("does not let an extra key on the rows object into the document", async () => {
    // A future loader that happens to fetch more must not widen the export
    // by accident — the table list is the list above, not "whatever came".
    const rows = { ...emptyRows(), stripe_events: [{ eventId: "evt_1" }] };

    const result = await assembleUserExport({
      userId: USER_ID,
      rows: rows as UserExportRows,
      clients: {},
    });

    expect("stripe_events" in result.database).toBe(false);
  });

  it("carries derived columns as stored — art. 15 is wider than art. 20", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: {},
    });

    expect(result.database.users[0]).toMatchObject({
      country: "ES",
      attributionFirstSource: "tiktok",
      stripeCustomerId: "cus_subject",
    });
  });

  it("says so when the account has no users row, and still tries the vendors", async () => {
    const getUser = vi.fn(async () => clerkUser());

    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows(),
      clients: { clerk: { users: { getUser } } },
    });

    expect(result.notes.some((n) => n.startsWith("database: no users row"))).toBe(true);
    expect(getUser).toHaveBeenCalledWith(USER_ID);
    expect(result.processors.clerk?.id).toBe("user_2subject");
  });

  it("refuses a subject id that could not be a Clerk id", async () => {
    await expect(
      assembleUserExport({ userId: "../etc/passwd", rows: emptyRows(), clients: {} }),
    ).rejects.toThrow(/unexpected shape/);
  });
});

// ── (б) the database keys ───────────────────────────────────────────────

/**
 * A `db.select().from(t).where(c)` recorder: renders every clause through
 * the real Postgres dialect so the assertion reads the SQL that would run.
 */
function recorderDb(rowsByTable: Record<string, unknown[]>) {
  const dialect = new PgDialect();
  const calls: { table: string; sql: string; params: unknown[] }[] = [];
  const db = {
    select: () => ({
      from: (table: PgTable) => ({
        where: async (clause: SQL | undefined) => {
          const name = getTableName(table);
          const q = clause ? dialect.sqlToQuery(clause) : { sql: "", params: [] };
          calls.push({ table: name, sql: q.sql, params: q.params });
          return rowsByTable[name] ?? [];
        },
      }),
    }),
  };
  return { db: db as unknown as ExportDb, calls };
}

describe("loadUserExportRows · every table by its own key", () => {
  it("reads the six user-keyed tables by user_id, visitor_days by the visitors found, show_reminders by user_id OR email", async () => {
    const { db, calls } = recorderDb({
      users: [account],
      visitors: [{ aid: "aid-1" }, { aid: "aid-2" }],
      show_reminders: [{ id: "rem_1" }],
    });

    const rows = await loadUserExportRows(db, USER_ID);

    const byTable = Object.fromEntries(calls.map((c) => [c.table, c]));
    expect(byTable.users).toMatchObject({ sql: '"users"."id" = $1', params: [USER_ID] });
    for (const table of ["subscriptions", "watch_progress", "watch_days", "trial_sessions", "visitors"]) {
      expect(byTable[table], table).toMatchObject({
        sql: `"${table}"."user_id" = $1`,
        params: [USER_ID],
      });
    }
    expect(byTable.visitor_days).toMatchObject({
      sql: '"visitor_days"."aid" in ($1, $2)',
      params: ["aid-1", "aid-2"],
    });
    expect(byTable.show_reminders).toMatchObject({
      sql: '("show_reminders"."user_id" = $1 or "show_reminders"."email" = $2)',
      params: [USER_ID, account.email],
    });
    // Exactly the eight tables, each once.
    expect(calls.map((c) => c.table).sort()).toEqual([...EXPORT_TABLES].sort());
    expect(rows.users).toEqual([account]);
    expect(rows.show_reminders).toEqual([{ id: "rem_1" }]);
  });

  it("skips visitor_days when no visitor row is linked, and keys reminders by user_id alone without an account row", async () => {
    const { db, calls } = recorderDb({});

    const rows = await loadUserExportRows(db, USER_ID);

    const tables = calls.map((c) => c.table);
    expect(tables).not.toContain("visitor_days");
    expect(rows.visitor_days).toEqual([]);
    const reminders = calls.find((c) => c.table === "show_reminders");
    expect(reminders).toMatchObject({
      sql: '"show_reminders"."user_id" = $1',
      params: [USER_ID],
    });
  });
});

// ── (в) vendors: best-effort ────────────────────────────────────────────

function clerkUser() {
  return {
    id: USER_ID,
    emailAddresses: [
      { emailAddress: "subject@example.invalid", verification: { status: "verified" } },
      { emailAddress: "old@example.invalid", verification: null },
    ],
    firstName: "Sub",
    lastName: "Ject",
    createdAt: Date.UTC(2026, 0, 1),
    lastSignInAt: Date.UTC(2026, 8, 1),
  };
}

async function* invoicesOf(list: StripeInvoiceLike[]) {
  for (const inv of list) yield inv;
}

function stripeClient(over: Partial<StripeClientLike> = {}): StripeClientLike {
  return {
    customers: {
      retrieve: async (id) => ({
        id,
        email: "subject@example.invalid",
        name: "Sub Ject",
        address: { line1: "1 Example St", city: "Madrid", country: "ES" },
        created: 1_735_689_600,
      }),
    },
    invoices: {
      list: () =>
        invoicesOf([
          {
            id: "in_1",
            number: "0001",
            amount_due: 100,
            amount_paid: 100,
            currency: "usd",
            status: "paid",
            created: 1_735_689_600,
            hosted_invoice_url: "https://invoice.stripe.com/i/dummy",
          },
          { id: "in_2", number: null, amount_due: 3800, amount_paid: 0, currency: "usd", status: "open" },
        ]),
    },
    ...over,
  };
}

describe("assembleUserExport · vendors", () => {
  it("clerk: picks the profile fields and notes that sessions are not part of it", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: { clerk: { users: { getUser: async () => clerkUser() } } },
    });

    expect(result.processors.clerk).toEqual({
      id: USER_ID,
      emailAddresses: [
        { emailAddress: "subject@example.invalid", verified: true },
        { emailAddress: "old@example.invalid", verified: false },
      ],
      firstName: "Sub",
      lastName: "Ject",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastSignInAt: "2026-09-01T00:00:00.000Z",
    });
    expect(result.notes.some((n) => n.startsWith("clerk:") && /sessions/.test(n))).toBe(true);
  });

  it("a missing vendor key → null plus a note pointing at the runbook", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: { clerk: null, stripe: undefined },
    });

    expect(result.processors).toEqual({ clerk: null, stripe: null, posthog: null });
    expect(result.notes).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^clerk: skipped — CLERK_SECRET_KEY not set; .*gdpr-requests\.md/),
        expect.stringMatching(/^stripe: skipped — STRIPE_SECRET_KEY not set/),
        expect.stringMatching(/^posthog: skipped — POSTHOG_PERSONAL_API_KEY \+ POSTHOG_PROJECT_ID not set/),
      ]),
    );
  });

  it("a vendor that throws → null plus a note with the error's name/status, never its message", async () => {
    const clerk: ClerkClientLike = {
      users: {
        getUser: async () => {
          throw Object.assign(new Error("Not Found: no user with email subject@example.invalid"), {
            name: "ClerkAPIResponseError",
            status: 404,
          });
        },
      },
    };
    const posthog: PosthogClientLike = {
      runHogQL: async () => {
        throw new Error("PostHog query API 500");
      },
    };

    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: { clerk, posthog },
    });

    expect(result.processors.clerk).toBeNull();
    expect(result.processors.posthog).toBeNull();
    expect(result.notes).toContain(
      "clerk: failed (ClerkAPIResponseError/404) — export by hand (docs/runbooks/gdpr-requests.md)",
    );
    expect(result.notes).toContain(
      "posthog: failed (Error) — export by hand (docs/runbooks/gdpr-requests.md)",
    );
    expect(result.notes.join("\n")).not.toContain("subject@example.invalid");
  });

  it("clerk: a call that never answers is cut off after its budget → null + a TimeoutError note", async () => {
    // Clerk's SDK takes no AbortSignal; the race against the clock is what
    // keeps an operator's terminal from hanging on a stuck vendor.
    vi.useFakeTimers();
    try {
      const pending = assembleUserExport({
        userId: USER_ID,
        rows: emptyRows({ users: [account] }),
        clients: { clerk: { users: { getUser: () => new Promise<never>(() => {}) } } },
      });
      await vi.advanceTimersByTimeAsync(CLERK_TIMEOUT_MS);
      const result = await pending;

      expect(result.processors.clerk).toBeNull();
      expect(result.notes).toContain(
        "clerk: failed (TimeoutError) — export by hand (docs/runbooks/gdpr-requests.md)",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stripe: the customer by users.stripe_customer_id plus every invoice through auto-pagination, each request on a 30s budget", async () => {
    const retrieve = vi.fn(stripeClient().customers.retrieve);
    const list = vi.fn(stripeClient().invoices.list);

    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: { stripe: { customers: { retrieve }, invoices: { list } } },
    });

    // (id, params, options) — Stripe's request options are the third argument.
    expect(retrieve).toHaveBeenCalledWith("cus_subject", undefined, { timeout: STRIPE_TIMEOUT_MS });
    expect(list).toHaveBeenCalledWith(
      { customer: "cus_subject", limit: 100 },
      { timeout: STRIPE_TIMEOUT_MS },
    );
    expect(result.processors.stripe).toEqual({
      customer: {
        id: "cus_subject",
        email: "subject@example.invalid",
        name: "Sub Ject",
        address: { line1: "1 Example St", city: "Madrid", country: "ES" },
        created: "2025-01-01T00:00:00.000Z",
      },
      invoices: [
        {
          id: "in_1",
          number: "0001",
          amount_due: 100,
          amount_paid: 100,
          currency: "usd",
          status: "paid",
          created: "2025-01-01T00:00:00.000Z",
          hosted_invoice_url: "https://invoice.stripe.com/i/dummy",
        },
        {
          id: "in_2",
          number: null,
          amount_due: 3800,
          amount_paid: 0,
          currency: "usd",
          status: "open",
          created: null,
          hosted_invoice_url: null,
        },
      ],
    });
  });

  it("stripe: an account without a customer is a definite empty answer, not a skip", async () => {
    const retrieve = vi.fn();

    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [{ ...account, stripeCustomerId: null }] }),
      clients: { stripe: stripeClient({ customers: { retrieve } }) },
    });

    expect(retrieve).not.toHaveBeenCalled();
    expect(result.processors.stripe).toEqual({ customer: null, invoices: [] });
    expect(result.notes).toContain("stripe: no customer linked to the account — nothing to fetch");
  });

  it("stripe: a customer deleted at Stripe keeps the invoices and drops the customer block", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: {
        stripe: stripeClient({
          customers: { retrieve: async (id) => ({ id, deleted: true }) },
        }),
      },
    });

    expect(result.processors.stripe?.customer).toBeNull();
    expect(result.processors.stripe?.invoices).toHaveLength(2);
    expect(result.notes).toContain(
      "stripe: customer cus_subject is deleted at Stripe — only the invoices are listed",
    );
  });

  it("posthog: events by the person behind the distinct_id (properties parsed) and the person itself", async () => {
    const queries: string[] = [];
    const posthog: PosthogClientLike = {
      runHogQL: async (query) => {
        queries.push(query);
        if (query.startsWith("SELECT event,")) {
          return [
            ["$pageview", "2026-09-01T10:00:00Z", JSON.stringify({ $current_url: "https://matio.tv/" })],
            ["show_viewed", "2026-09-01T10:01:00Z", { show_slug: "scarlet-oath" }],
          ];
        }
        return [["person-uuid", "2026-08-30T00:00:00Z", true, JSON.stringify({ email: "subject@example.invalid" })]];
      },
    };

    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: { posthog },
    });

    expect(queries).toEqual([posthogEventsQuery(USER_ID), posthogPersonQuery(USER_ID)]);
    expect(result.processors.posthog).toEqual({
      distinctId: USER_ID,
      person: {
        id: "person-uuid",
        createdAt: "2026-08-30T00:00:00Z",
        isIdentified: true,
        properties: { email: "subject@example.invalid" },
      },
      events: [
        { event: "$pageview", timestamp: "2026-09-01T10:00:00Z", properties: { $current_url: "https://matio.tv/" } },
        { event: "show_viewed", timestamp: "2026-09-01T10:01:00Z", properties: { show_slug: "scarlet-oath" } },
      ],
    });
  });

  it("posthog: no person and no events is an empty answer; hitting the cap adds a note", async () => {
    const empty = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: { posthog: { runHogQL: async () => [] } },
    });
    expect(empty.processors.posthog).toEqual({ distinctId: USER_ID, person: null, events: [] });
    expect(empty.notes.some((n) => n.startsWith("posthog:"))).toBe(false);

    const capped = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({ users: [account] }),
      clients: {
        posthog: {
          runHogQL: async (query) =>
            query.startsWith("SELECT event,")
              ? Array.from({ length: POSTHOG_EVENTS_LIMIT }, () => ["$pageview", "t", "{}"])
              : [],
        },
      },
    });
    expect(capped.processors.posthog?.events).toHaveLength(POSTHOG_EVENTS_LIMIT);
    expect(capped.notes).toContain(
      `posthog: events capped at ${POSTHOG_EVENTS_LIMIT} — older events may exist; export the rest by hand (docs/runbooks/gdpr-requests.md)`,
    );
  });
});

describe("HogQL for the subject", () => {
  it("keys BOTH statements by the person behind the id — pre-identify events included — and caps the events", () => {
    // Events captured before posthog-js `identify()` sit on the same person
    // under the anonymous distinct_id; a `distinct_id =` filter would drop
    // them, so the events statement resolves the person exactly like the
    // person statement does.
    expect(posthogEventsQuery("user_2abc")).toBe(
      "SELECT event, timestamp, properties FROM events WHERE person_id IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id = 'user_2abc') ORDER BY timestamp LIMIT 10000",
    );
    expect(posthogPersonQuery("user_2abc")).toBe(
      "SELECT id, created_at, is_identified, properties FROM persons WHERE id IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id = 'user_2abc') LIMIT 1",
    );
  });

  it("refuses an id that could break out of the literal", () => {
    expect(() => posthogEventsQuery("user_1' OR 1=1 --")).toThrow(/unexpected shape/);
    expect(() => posthogPersonQuery("")).toThrow(/unexpected shape/);
  });
});

describe("errorLabel", () => {
  it("keeps name, string code and numeric status — never the message", () => {
    const err = Object.assign(new Error("Invalid API Key provided: sk_test_***"), {
      name: "StripeAuthenticationError",
      code: "api_key_expired",
      statusCode: 401,
    });
    expect(errorLabel(err)).toBe("StripeAuthenticationError/api_key_expired/401");
    expect(errorLabel(new Error("plain"))).toBe("Error");
    expect(errorLabel("not an error")).toBe("unknown");
  });
});

// ── (г) the operator summary ────────────────────────────────────────────

describe("summarizeExport", () => {
  it("prints counts per table and one word per vendor — not one value", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: emptyRows({
        users: [account],
        show_reminders: [{ id: "rem_1", email: account.email } as never, { id: "rem_2" } as never],
      }),
      clients: {
        clerk: { users: { getUser: async () => clerkUser() } },
        stripe: stripeClient(),
        posthog: { runHogQL: async (q) => (q.startsWith("SELECT event,") ? [["$pageview", "t", "{}"]] : []) },
      },
      now: NOW,
    });

    const summary = summarizeExport(result);

    expect(summary).toContain(`subject: ${USER_ID}`);
    expect(summary).toContain(
      "database rows: users=1 subscriptions=0 watch_progress=0 watch_days=0 trial_sessions=0 visitors=0 visitor_days=0 show_reminders=2",
    );
    expect(summary).toContain("processors: clerk=received stripe=received (invoices=2) posthog=received (events=1)");
    expect(summary).toContain("notes (1):");
    expect(summary).not.toContain("subject@example.invalid");
    expect(summary).not.toContain("Sub Ject");
    expect(summary).not.toContain("1 Example St");
    expect(summary).not.toContain("matio.tv/");
  });

  it("marks every missing vendor as skipped", async () => {
    const result = await assembleUserExport({ userId: USER_ID, rows: emptyRows(), clients: {} });

    expect(summarizeExport(result)).toContain("processors: clerk=skipped stripe=skipped posthog=skipped");
  });
});

// ── (д) the CLI parser ──────────────────────────────────────────────────

describe("parseExportArgs", () => {
  it("needs a user id", () => {
    expect(parseExportArgs([])).toMatchObject({ ok: false, reason: "missing_user_id" });
  });

  it("takes the id and an optional --out in either spelling", () => {
    expect(parseExportArgs(["user_2abc"])).toEqual({ ok: true, userId: "user_2abc", out: null });
    expect(parseExportArgs(["user_2abc", "--out", "/tmp/x.json"])).toEqual({
      ok: true,
      userId: "user_2abc",
      out: "/tmp/x.json",
    });
    expect(parseExportArgs(["--out=./x.json", "user_2abc"])).toEqual({
      ok: true,
      userId: "user_2abc",
      out: "./x.json",
    });
  });

  it("refuses a dangling --out, an unknown flag, a second positional and an id that is not a Clerk id", () => {
    expect(parseExportArgs(["user_2abc", "--out"])).toMatchObject({ reason: "missing_out_value" });
    expect(parseExportArgs(["user_2abc", "--out", "--force"])).toMatchObject({ reason: "missing_out_value" });
    expect(parseExportArgs(["--apply", "user_2abc"])).toMatchObject({ reason: "unknown_argument" });
    expect(parseExportArgs(["user_2abc", "user_2def"])).toMatchObject({ reason: "unknown_argument" });
    expect(parseExportArgs(["../../etc/passwd"])).toMatchObject({ reason: "invalid_user_id" });
    expect(parseExportArgs(["a@b.invalid"])).toMatchObject({ reason: "invalid_user_id" });
  });

  it("names the default file after the subject and the day, inside the directory it is given", () => {
    // The script passes os.tmpdir() — never the working directory, which is
    // the repository; a default there would be one `git add -A` from a leak.
    expect(defaultExportPath("user_2abc", NOW, "/var/tmp")).toBe(
      "/var/tmp/export-user_2abc-2026-09-07.json",
    );
    expect(defaultExportPath("user_2abc", NOW, "/var/tmp/")).toBe(
      "/var/tmp/export-user_2abc-2026-09-07.json",
    );
  });
});
