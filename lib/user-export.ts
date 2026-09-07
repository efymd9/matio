import type {
  ShowReminder,
  Subscription,
  TrialSession,
  User,
  Visitor,
  VisitorDay,
  WatchDay,
  WatchProgress,
} from "@/db/schema";

// Subject-access / portability export (GDPR art. 15 / 20) — the PURE half.
//
// This module assembles the export document from rows and vendor answers it
// is handed, formats the operator's stdout summary and parses the script's
// arguments. It reads no environment and opens no connection: the database
// rows come from lib/user-export-db.ts, the vendor clients are injected by
// scripts/export-user-data.ts (the only consumer besides the tests), which is
// also why it carries no `server-only` marker — that marker throws when a
// tsx script imports the module, and nothing in the app imports this one.
//
// Two rules the shape encodes:
//   * the eight tables that can be tied to a person are ALWAYS present as
//     keys, even with zero rows — the subject sees what was looked at, not
//     only what was found; `stripe_events` is deliberately not one of them
//     (raw vendor webhooks carrying other people's fields);
//   * derived data (country, attribution, `converted`, the visitor-day
//     flags) is exported as stored — art. 15 is wider than art. 20, and the
//     runbook says which is which in the covering letter.
//
// Vendors are best-effort: a missing key or a failed call yields `null` plus
// a note that says "export by hand", never a throw — one vendor's outage
// must not block the database half of a 30-day-deadline request. Vendor
// error MESSAGES never enter the document or the summary: Stripe and Clerk
// quote request parameters (the address included) in theirs, so only the
// error's name / code / status survive (see lib/log-audit.test.ts).

export const EXPORT_TABLES = [
  "users",
  "subscriptions",
  "watch_progress",
  "watch_days",
  "trial_sessions",
  "visitors",
  "visitor_days",
  "show_reminders",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

export type UserExportRows = {
  users: User[];
  subscriptions: Subscription[];
  watch_progress: WatchProgress[];
  watch_days: WatchDay[];
  trial_sessions: TrialSession[];
  visitors: Visitor[];
  visitor_days: VisitorDay[];
  show_reminders: ShowReminder[];
};

// ── Vendor clients: the minimum surface each call needs ─────────────────
// Structural on purpose — the real SDK clients satisfy them by shape, the
// tests pass plain objects, and the field lists double as the contract for
// WHAT is read from each vendor (everything else on the vendor object is
// ignored, never copied wholesale).

export type ClerkUserLike = {
  id: string;
  emailAddresses: {
    emailAddress: string;
    verification: { status: string } | null;
  }[];
  firstName: string | null;
  lastName: string | null;
  /** Epoch milliseconds (Clerk's Backend API convention). */
  createdAt: number;
  lastSignInAt: number | null;
};

export type ClerkClientLike = {
  users: { getUser(userId: string): Promise<ClerkUserLike> };
};

export type StripeAddressLike = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export type StripeCustomerLike = {
  id: string;
  /** `true` on Stripe's DeletedCustomer; `void` on a live Customer. */
  deleted?: unknown;
  email?: string | null;
  name?: string | null;
  address?: StripeAddressLike | null;
  /** Epoch seconds (Stripe's convention). */
  created?: number;
};

export type StripeInvoiceLike = {
  id: string;
  number?: string | null;
  amount_due?: number;
  amount_paid?: number;
  currency?: string;
  status?: string | null;
  /** Epoch seconds. */
  created?: number;
  hosted_invoice_url?: string | null;
};

export type StripeClientLike = {
  customers: { retrieve(id: string): Promise<StripeCustomerLike> };
  invoices: {
    list(params: {
      customer: string;
      limit?: number;
    }): AsyncIterable<StripeInvoiceLike>;
  };
};

/** One HogQL round-trip; rows come back as positional arrays. */
export type PosthogClientLike = {
  runHogQL(query: string): Promise<unknown[][]>;
};

export type ProcessorClients = {
  clerk?: ClerkClientLike | null;
  stripe?: StripeClientLike | null;
  posthog?: PosthogClientLike | null;
};

// ── The document ────────────────────────────────────────────────────────

export type ClerkExport = {
  id: string;
  emailAddresses: { emailAddress: string; verified: boolean }[];
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};

export type StripeExport = {
  /** null = no customer linked to the account, or deleted at Stripe. */
  customer: {
    id: string;
    email: string | null;
    name: string | null;
    address: StripeAddressLike | null;
    created: string | null;
  } | null;
  invoices: {
    id: string;
    number: string | null;
    amount_due: number | null;
    amount_paid: number | null;
    currency: string | null;
    status: string | null;
    created: string | null;
    hosted_invoice_url: string | null;
  }[];
};

export type PosthogExport = {
  distinctId: string;
  person: {
    id: string;
    createdAt: string | null;
    isIdentified: boolean;
    properties: unknown;
  } | null;
  events: { event: string; timestamp: string; properties: unknown }[];
};

export type UserExport = {
  exportedAt: string;
  subject: { userId: string };
  database: UserExportRows;
  processors: {
    clerk: ClerkExport | null;
    stripe: StripeExport | null;
    posthog: PosthogExport | null;
  };
  notes: string[];
};

export const RUNBOOK = "docs/runbooks/gdpr-requests.md";

// Clerk ids are `user_` + base62; the same shape rule guards the output
// filename (the id is part of it) and the HogQL literal (the id is quoted
// into it). Anything outside this charset is refused before either.
const SUBJECT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isSubjectId(value: string): boolean {
  return SUBJECT_ID_RE.test(value);
}

// ── PostHog queries ─────────────────────────────────────────────────────
// Deliberately no timestamp bound: a subject-access answer is the whole
// history, not a window. Validated against the live project (syntax only,
// against a nonexistent id) on 2026-09-07.

export const POSTHOG_EVENTS_LIMIT = 10_000;

function hogLiteral(subjectId: string): string {
  if (!isSubjectId(subjectId)) {
    throw new Error("subject id has an unexpected shape");
  }
  return `'${subjectId}'`;
}

export function posthogEventsQuery(distinctId: string): string {
  return `SELECT event, timestamp, properties FROM events WHERE distinct_id = ${hogLiteral(distinctId)} ORDER BY timestamp LIMIT ${POSTHOG_EVENTS_LIMIT}`;
}

export function posthogPersonQuery(distinctId: string): string {
  return `SELECT id, created_at, is_identified, properties FROM persons WHERE id IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id = ${hogLiteral(distinctId)}) LIMIT 1`;
}

// ── Vendor fetchers ─────────────────────────────────────────────────────

function isoFromMillis(ms: number | null | undefined): string | null {
  return typeof ms === "number" && Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : null;
}

function isoFromSeconds(s: number | null | undefined): string | null {
  return typeof s === "number" && Number.isFinite(s)
    ? new Date(s * 1000).toISOString()
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** HogQL returns JSON columns as strings on some paths — keep both. */
function jsonMaybe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function fetchClerk(
  client: ClerkClientLike,
  userId: string,
): Promise<ClerkExport> {
  const user = await client.users.getUser(userId);
  return {
    id: user.id,
    emailAddresses: user.emailAddresses.map((e) => ({
      emailAddress: e.emailAddress,
      verified: e.verification?.status === "verified",
    })),
    firstName: user.firstName,
    lastName: user.lastName,
    createdAt: isoFromMillis(user.createdAt) ?? "",
    lastSignInAt: isoFromMillis(user.lastSignInAt),
  };
}

async function fetchStripe(
  client: StripeClientLike,
  customerId: string,
  notes: string[],
): Promise<StripeExport> {
  const customer = await client.customers.retrieve(customerId);
  const invoices: StripeExport["invoices"] = [];
  for await (const inv of client.invoices.list({
    customer: customerId,
    limit: 100,
  })) {
    invoices.push({
      id: inv.id,
      number: inv.number ?? null,
      amount_due: inv.amount_due ?? null,
      amount_paid: inv.amount_paid ?? null,
      currency: inv.currency ?? null,
      status: inv.status ?? null,
      created: isoFromSeconds(inv.created),
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
    });
  }
  if (customer.deleted === true) {
    notes.push(
      `stripe: customer ${customerId} is deleted at Stripe — only the invoices are listed`,
    );
    return { customer: null, invoices };
  }
  return {
    customer: {
      id: customer.id,
      email: customer.email ?? null,
      name: customer.name ?? null,
      address: customer.address ?? null,
      created: isoFromSeconds(customer.created),
    },
    invoices,
  };
}

async function fetchPosthog(
  client: PosthogClientLike,
  distinctId: string,
  notes: string[],
): Promise<PosthogExport> {
  const eventRows = await client.runHogQL(posthogEventsQuery(distinctId));
  const events = eventRows.map((row) => ({
    event: str(row[0]) ?? "",
    timestamp: str(row[1]) ?? "",
    properties: jsonMaybe(row[2]),
  }));
  if (events.length >= POSTHOG_EVENTS_LIMIT) {
    notes.push(
      `posthog: events capped at ${POSTHOG_EVENTS_LIMIT} — older events may exist; export the rest by hand (${RUNBOOK})`,
    );
  }
  const personRows = await client.runHogQL(posthogPersonQuery(distinctId));
  const p = personRows[0];
  const person = p
    ? {
        id: str(p[0]) ?? "",
        createdAt: str(p[1]),
        isIdentified: p[2] === true || p[2] === 1,
        properties: jsonMaybe(p[3]),
      }
    : null;
  return { distinctId, person, events };
}

// ── Best-effort wrapper ─────────────────────────────────────────────────

/** name / code / status only — vendor messages quote the request. */
export function errorLabel(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const parts = [err.name || "Error"];
  const e = err as Error & {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  if (typeof e.code === "string") parts.push(e.code);
  const status = e.status ?? e.statusCode;
  if (typeof status === "number") parts.push(String(status));
  return parts.join("/");
}

async function bestEffort<T>(
  name: "clerk" | "stripe" | "posthog",
  envHint: string,
  client: unknown,
  notes: string[],
  run: () => Promise<T>,
): Promise<T | null> {
  if (!client) {
    notes.push(
      `${name}: skipped — ${envHint} not set; export by hand (${RUNBOOK})`,
    );
    return null;
  }
  try {
    return await run();
  } catch (err) {
    notes.push(
      `${name}: failed (${errorLabel(err)}) — export by hand (${RUNBOOK})`,
    );
    return null;
  }
}

// ── Assembly ────────────────────────────────────────────────────────────

export type AssembleInput = {
  userId: string;
  rows: UserExportRows;
  clients: ProcessorClients;
  /** Injectable clock for a stable `exportedAt` in tests. */
  now?: Date;
};

export async function assembleUserExport(
  input: AssembleInput,
): Promise<UserExport> {
  const { userId, rows, clients } = input;
  if (!isSubjectId(userId)) {
    throw new Error("subject id has an unexpected shape");
  }
  const notes: string[] = [];
  const account = rows.users[0];
  if (!account) {
    notes.push(
      "database: no users row for this id — the account was never mirrored or is already erased; the vendor halves below are still attempted",
    );
  }

  const clerk = await bestEffort(
    "clerk",
    "CLERK_SECRET_KEY",
    clients.clerk,
    notes,
    () => fetchClerk(clients.clerk!, userId),
  );
  if (clerk) {
    notes.push(
      "clerk: the profile above is what the Backend API exposes; sign-in sessions and devices are not part of it — the subject sees those in their own account settings",
    );
  }

  const customerId = account?.stripeCustomerId ?? null;
  const stripe = await bestEffort(
    "stripe",
    "STRIPE_SECRET_KEY",
    clients.stripe,
    notes,
    async () => {
      if (!customerId) {
        notes.push(
          "stripe: no customer linked to the account — nothing to fetch",
        );
        return { customer: null, invoices: [] } satisfies StripeExport;
      }
      return fetchStripe(clients.stripe!, customerId, notes);
    },
  );

  const posthog = await bestEffort(
    "posthog",
    "POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID",
    clients.posthog,
    notes,
    () => fetchPosthog(clients.posthog!, userId, notes),
  );

  return {
    exportedAt: (input.now ?? new Date()).toISOString(),
    subject: { userId },
    // Listed key by key on purpose: the document's table set is THIS list,
    // whatever else a future `rows` object happens to carry.
    database: {
      users: rows.users,
      subscriptions: rows.subscriptions,
      watch_progress: rows.watch_progress,
      watch_days: rows.watch_days,
      trial_sessions: rows.trial_sessions,
      visitors: rows.visitors,
      visitor_days: rows.visitor_days,
      show_reminders: rows.show_reminders,
    },
    processors: { clerk, stripe, posthog },
    notes,
  };
}

// ── Operator output ─────────────────────────────────────────────────────

/**
 * What the script prints: the subject id, row COUNTS per table, one word
 * per vendor and the notes — which are authored here and carry no values.
 * Never a row, never a field. The log audit pins this.
 */
export function summarizeExport(result: UserExport): string {
  const counts = EXPORT_TABLES.map(
    (t) => `${t}=${result.database[t].length}`,
  ).join(" ");
  const p = result.processors;
  const vendor = (name: string, value: unknown, extra?: string) =>
    `${name}=${value ? `received${extra ? ` (${extra})` : ""}` : "skipped"}`;
  const vendors = [
    vendor("clerk", p.clerk),
    vendor("stripe", p.stripe, p.stripe ? `invoices=${p.stripe.invoices.length}` : undefined),
    vendor("posthog", p.posthog, p.posthog ? `events=${p.posthog.events.length}` : undefined),
  ].join(" ");
  const lines = [
    `subject: ${result.subject.userId}`,
    `database rows: ${counts}`,
    `processors: ${vendors}`,
  ];
  if (result.notes.length > 0) {
    lines.push(`notes (${result.notes.length}):`);
    for (const note of result.notes) lines.push(`  - ${note}`);
  }
  return lines.join("\n");
}

// ── CLI arguments ───────────────────────────────────────────────────────

export const USAGE =
  "usage: DATABASE_URL=<host> pnpm export-user-data <userId> [--out <file>]\n" +
  "  userId  — the Clerk id (users.id), e.g. user_2abc…; look it up in Clerk by the requester's address\n" +
  "  --out   — where to write the JSON (default ./export-<userId>-<YYYY-MM-DD>.json, mode 0600)\n" +
  "  Optional, best-effort: CLERK_SECRET_KEY, STRIPE_SECRET_KEY, POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID.\n" +
  "  Nothing is read from .env.local on purpose — every variable is passed explicitly.";

export type ParsedExportArgs =
  | { ok: true; userId: string; out: string | null }
  | {
      ok: false;
      reason: "missing_user_id" | "invalid_user_id" | "missing_out_value" | "unknown_argument";
      message: string;
    };

export function parseExportArgs(argv: readonly string[]): ParsedExportArgs {
  let userId: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        return { ok: false, reason: "missing_out_value", message: "--out needs a file path" };
      }
      out = value;
      i += 1;
    } else if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) {
        return { ok: false, reason: "missing_out_value", message: "--out needs a file path" };
      }
      out = value;
    } else if (arg.startsWith("-") || userId !== null) {
      return { ok: false, reason: "unknown_argument", message: `unexpected argument: ${arg}` };
    } else {
      userId = arg;
    }
  }
  if (userId === null) {
    return { ok: false, reason: "missing_user_id", message: "missing <userId>" };
  }
  if (!isSubjectId(userId)) {
    return {
      ok: false,
      reason: "invalid_user_id",
      message: "userId may only contain letters, digits, '_' and '-' (it names the output file)",
    };
  }
  return { ok: true, userId, out };
}

export function defaultExportPath(userId: string, now: Date): string {
  return `./export-${userId}-${now.toISOString().slice(0, 10)}.json`;
}
