import crypto from "node:crypto";
import { is, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The database is faked at the query-builder boundary and everything else is
// real: the Svix signature check runs for real against a fake secret, the
// Drizzle schema is the real one (its FK actions are the cascade), and the
// predicates the handler hands the driver are rendered to SQL and asserted —
// what is under test is WHICH rows the handler asks Postgres to touch, and
// that an unsigned request touches none.
const h = vi.hoisted(() => ({
  userRow: undefined as
    | { email: string; stripeCustomerId: string | null }
    | undefined,
  liveSub: undefined as { stripeSubscriptionId: string } | undefined,
  selects: [] as { table: string; where: unknown }[],
  deletes: [] as { table: string; where: unknown }[],
  inserts: [] as { table: string; values: unknown }[],
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Table = Parameters<typeof getTableName>[0];
  return {
    db: {
      select: () => ({
        from: (table: Table) => ({
          where: (where: unknown) => ({
            limit: async () => {
              const name = getTableName(table);
              h.selects.push({ table: name, where });
              if (name === "users") return h.userRow ? [h.userRow] : [];
              if (name === "subscriptions") return h.liveSub ? [h.liveSub] : [];
              throw new Error(`unexpected select from ${name}`);
            },
          }),
        }),
      }),
      delete: (table: Table) => ({
        where: (where: unknown) => {
          const name = getTableName(table);
          h.deletes.push({ table: name, where });
          return Object.assign(Promise.resolve(undefined), {
            returning: async () =>
              name === "show_reminders" ? [{ id: "rem_1" }, { id: "rem_2" }] : [],
          });
        },
      }),
      insert: (table: Table) => ({
        values: (values: unknown) => ({
          onConflictDoNothing: async () => {
            h.inserts.push({ table: getTableName(table), values });
          },
        }),
      }),
    },
  };
});

import * as schema from "@/db/schema";
import { POST } from "./route";

// Obviously fake, and shaped like the real thing (`whsec_` + base64) so the
// verifier's secret parsing runs the same code path as production.
const SIGNING_SECRET = `whsec_${Buffer.from("dummy-clerk-webhook-secret").toString("base64")}`;
const USER_ID = "user_2abc";
const EMAIL = "someone@example.invalid";

/** A request signed the way Clerk (Svix / Standard Webhooks) signs it. */
function signed(
  event: unknown,
  opts: { headers?: Record<string, string>; tamper?: boolean } = {},
) {
  const body = JSON.stringify(event);
  const id = "msg_test";
  const ts = String(Math.floor(Date.now() / 1000));
  const key = Buffer.from(SIGNING_SECRET.slice("whsec_".length), "base64");
  const signature = crypto
    .createHmac("sha256", key)
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "svix-id": id,
    "svix-timestamp": ts,
    "svix-signature": `v1,${signature}`,
    ...opts.headers,
  };
  return new Request("https://matio.tv/api/webhooks/clerk", {
    method: "POST",
    headers,
    body: opts.tamper ? body.replace(USER_ID, "user_other") : body,
  }) as unknown as Parameters<typeof POST>[0];
}

const userDeleted = (id?: string) => ({
  type: "user.deleted",
  object: "event",
  data: { object: "user", deleted: true, ...(id ? { id } : {}) },
});

const userCreated = (emails: { id: string; email_address: string }[]) => ({
  type: "user.created",
  object: "event",
  data: {
    id: USER_ID,
    object: "user",
    primary_email_address_id: emails[0]?.id ?? null,
    email_addresses: emails,
  },
});

/** Render a Drizzle predicate the way the driver would see it. */
function render(where: unknown) {
  return new PgDialect().sqlToQuery(where as SQL);
}

beforeEach(() => {
  h.userRow = { email: EMAIL, stripeCustomerId: null };
  h.liveSub = undefined;
  h.selects.length = 0;
  h.deletes.length = 0;
  h.inserts.length = 0;
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SIGNING_SECRET);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Clerk webhook · signature", () => {
  it("refuses an unsigned request and touches nothing", async () => {
    const res = await POST(
      signed(userDeleted(USER_ID), {
        headers: { "svix-signature": "", "svix-id": "", "svix-timestamp": "" },
      }),
    );

    expect(res.status).toBe(400);
    expect(h.selects).toEqual([]);
    expect(h.deletes).toEqual([]);
  });

  it("refuses a payload whose body no longer matches its signature", async () => {
    const res = await POST(signed(userDeleted(USER_ID), { tamper: true }));

    expect(res.status).toBe(400);
    expect(h.deletes).toEqual([]);
  });

  it("refuses a signature made with another secret", async () => {
    vi.stubEnv(
      "CLERK_WEBHOOK_SIGNING_SECRET",
      `whsec_${Buffer.from("some-other-dummy-secret").toString("base64")}`,
    );

    const res = await POST(signed(userDeleted(USER_ID)));

    expect(res.status).toBe(400);
    expect(h.deletes).toEqual([]);
  });
});

describe("Clerk webhook · user.deleted", () => {
  it("erases the mirror row and the reminder rows, in that order", async () => {
    const res = await POST(signed(userDeleted(USER_ID)));

    expect(res.status).toBe(200);
    expect(h.deletes.map((d) => d.table)).toEqual(["show_reminders", "users"]);

    // Reminder rows: every row for the account's address OR linked to the
    // account — erased BEFORE the users row, while the user_id link exists.
    const reminders = render(h.deletes[0].where);
    expect(reminders.sql).toBe(
      '("show_reminders"."email" = $1 or "show_reminders"."user_id" = $2)',
    );
    expect(reminders.params).toEqual([EMAIL, USER_ID]);

    // The users row: one DELETE by Clerk id; the cascades take the rest.
    const user = render(h.deletes[1].where);
    expect(user.sql).toBe('"users"."id" = $1');
    expect(user.params).toEqual([USER_ID]);
  });

  it("matches reminder rows by the lowercased address", async () => {
    h.userRow = { email: "Someone@Example.INVALID", stripeCustomerId: null };

    await POST(signed(userDeleted(USER_ID)));

    expect(render(h.deletes[0].where).params[0]).toBe("someone@example.invalid");
  });

  it("is idempotent: a redelivery for an already-erased user is a 200 no-op", async () => {
    h.userRow = undefined;

    const res = await POST(signed(userDeleted(USER_ID)));

    expect(res.status).toBe(200);
    expect(h.deletes).toEqual([]);
  });

  it("still erases an account with a live Stripe subscription, but says so by id", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    h.liveSub = { stripeSubscriptionId: "sub_dummy" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(signed(userDeleted(USER_ID)));

    expect(res.status).toBe(200);
    expect(h.deletes.map((d) => d.table)).toEqual(["show_reminders", "users"]);
    expect(error).toHaveBeenCalledTimes(1);
    const [message, details] = error.mock.calls[0];
    expect(message).toContain("LIVE Stripe subscription");
    expect(details).toEqual({
      userId: USER_ID,
      stripeCustomerId: "cus_dummy",
      stripeSubscriptionId: "sub_dummy",
    });
  });

  it("looks for a live subscription with the access-granting predicate", async () => {
    await POST(signed(userDeleted(USER_ID)));

    const sub = h.selects.find((s) => s.table === "subscriptions");
    const q = render(sub?.where);
    expect(q.sql).toBe(
      '("subscriptions"."user_id" = $1 and "subscriptions"."status" in ($2, $3, $4) and "subscriptions"."current_period_end" > $5)',
    );
    expect(q.params.slice(0, 4)).toEqual([
      USER_ID,
      "active",
      "trialing",
      "past_due",
    ]);
  });

  it("stays quiet about a legacy Stripe customer without a live subscription", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(signed(userDeleted(USER_ID)));

    expect(res.status).toBe(200);
    expect(error).not.toHaveBeenCalled();
    expect(h.deletes.map((d) => d.table)).toEqual(["show_reminders", "users"]);
  });

  it("acknowledges a payload without an id and touches nothing", async () => {
    const res = await POST(signed(userDeleted()));

    expect(res.status).toBe(200);
    expect(h.selects).toEqual([]);
    expect(h.deletes).toEqual([]);
  });
});

describe("Clerk webhook · user.created (unchanged)", () => {
  it("mirrors the primary email into users", async () => {
    const res = await POST(
      signed(
        userCreated([
          { id: "idn_1", email_address: EMAIL },
          { id: "idn_2", email_address: "second@example.invalid" },
        ]),
      ),
    );

    expect(res.status).toBe(200);
    expect(h.inserts).toEqual([
      { table: "users", values: { id: USER_ID, email: EMAIL } },
    ]);
  });

  it("acknowledges an emailless user (Clerk's Send Example) without inserting", async () => {
    const res = await POST(signed(userCreated([])));

    expect(res.status).toBe(200);
    expect(h.inserts).toEqual([]);
  });
});

describe("Clerk webhook · what DELETE FROM users takes with it", () => {
  // The handler issues one DELETE and relies on the FK actions in db/schema/*
  // for everything else. This pins the whole map: a new table referencing
  // users without an ON DELETE action would make that DELETE fail with an FK
  // violation, the webhook 500, Clerk retry until it gives up — and erasure
  // would silently stop happening. Adding a table here means having decided
  // what account deletion does to it (and saying so in the /gdpr data map).
  it("every FK to users declares cascade or set null, and the map is exactly this", () => {
    const actual: Record<string, string | undefined> = {};
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const { name, foreignKeys } = getTableConfig(value);
      for (const fk of foreignKeys) {
        const ref = fk.reference();
        if (getTableConfig(ref.foreignTable).name !== "users") continue;
        actual[`${name}.${ref.columns.map((c) => c.name).join(",")}`] =
          fk.onDelete;
      }
    }

    expect(actual).toEqual({
      "subscriptions.user_id": "cascade",
      "watch_progress.user_id": "cascade",
      "watch_days.user_id": "cascade",
      "trial_sessions.user_id": "set null",
      "visitors.user_id": "set null",
      "show_reminders.user_id": "set null",
      "marketing_links.created_by": "set null",
    });
  });

  it("visitor_days follows visitors, which survives de-identified", () => {
    const [fk] = getTableConfig(schema.visitorDays).foreignKeys;
    expect(getTableConfig(fk.reference().foreignTable).name).toBe("visitors");
    expect(fk.onDelete).toBe("cascade");
  });
});
