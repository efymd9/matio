import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMessage = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureMessage: sentryMessage }));

import {
  ERASE_USAGE,
  eraseUser,
  escapeStripeSearchValue,
  parseEraseArgs,
  previewErasure,
  stepsLeftByHand,
  STRIPE_CANCEL_RETRIES,
  STRIPE_CANCEL_TIMEOUT_MS,
  STRIPE_SEARCH_LIMIT,
  stripeCustomerSearchQuery,
  summarizeErasePreview,
  summarizeEraseResult,
  type EraseDb,
  type ErasePreview,
  type EraseUserResult,
} from "./erase-user";

// The erasure core, run with the dependencies a caller hands in (the webhook
// passes the app's db/Stripe/PostHog; the script passes what the shell gave
// it). The webhook suite (app/api/webhooks/clerk/route.test.ts) pins the
// HTTP contract and the FK map; here the questions are the ones the script
// added: that the SAME code runs from an injected client, that PostHog is
// asked AFTER the local rows are gone (and even when they were gone
// already), that the dry run reads by the erasure's own predicates, and
// what the operator's stdout carries.

const USER_ID = "user_2abc";
const EMAIL = "Someone@Example.INVALID";
const CFG = { key: "phx_dummy", projectId: "190233" };

const h = {
  userRow: undefined as
    | { email: string; stripeCustomerId: string | null }
    | undefined,
  liveSub: undefined as { stripeSubscriptionId: string } | undefined,
  counts: {} as Record<string, number>,
  selects: [] as { table: string; where: unknown; fields: unknown }[],
  deletes: [] as { table: string; where: unknown }[],
  inserts: [] as { table: string; values: unknown }[],
  // Every write AND every PostHog request, in the order they happened.
  writes: [] as string[],
  insertFails: undefined as Error | undefined,
};

const stripeUpdate = vi.fn();
const stripeSearch = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

/** A recorder shaped like the three Drizzle entry points the core uses. */
function makeDb(): EraseDb {
  return {
    select: (fields: unknown) => ({
      from: (table: PgTable) => ({
        where: (where: unknown) => {
          const name = getTableName(table);
          h.selects.push({ table: name, where, fields });
          const counted = Promise.resolve([{ n: h.counts[name] ?? 0 }]);
          return Object.assign(counted, {
            limit: async () => {
              if (name === "users") return h.userRow ? [h.userRow] : [];
              if (name === "subscriptions") return h.liveSub ? [h.liveSub] : [];
              throw new Error(`unexpected select from ${name}`);
            },
          });
        },
      }),
    }),
    delete: (table: PgTable) => ({
      where: (where: unknown) => {
        const name = getTableName(table);
        h.deletes.push({ table: name, where });
        h.writes.push(`delete ${name}`);
        return Object.assign(Promise.resolve(undefined), {
          returning: async () =>
            name === "show_reminders" ? [{ id: "rem_1" }, { id: "rem_2" }] : [],
        });
      },
    }),
    insert: (table: PgTable) => ({
      values: (values: unknown) => ({
        onConflictDoNothing: async () => {
          if (h.insertFails) throw h.insertFails;
          const name = getTableName(table);
          h.inserts.push({ table: name, values });
          h.writes.push(`insert ${name}`);
        },
      }),
    }),
  } as unknown as EraseDb;
}

/** The two Stripe calls the erasure makes, both spies. */
const stripe = () => ({
  subscriptions: { update: stripeUpdate },
  customers: { search: stripeSearch },
});

const deps = () => ({ db: makeDb(), getStripe: stripe, posthog: null });

function render(where: unknown) {
  return new PgDialect().sqlToQuery(where as SQL);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/** PostHog answering "one person, deleted fine", and recording the order. */
function posthogDeletes() {
  fetchMock.mockImplementation(async (_url, init) => {
    h.writes.push(`posthog ${init?.method ?? "GET"}`);
    return init?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : json(200, { results: [{ id: 42 }] });
  });
}

beforeEach(() => {
  h.userRow = { email: EMAIL, stripeCustomerId: null };
  h.liveSub = undefined;
  h.counts = {};
  h.selects.length = 0;
  h.deletes.length = 0;
  h.inserts.length = 0;
  h.writes.length = 0;
  h.insertFails = undefined;
  stripeUpdate.mockReset().mockResolvedValue({ id: "sub_dummy" });
  // Stripe knows no customer for the address unless a case says otherwise.
  stripeSearch.mockReset().mockResolvedValue({ data: [], has_more: false });
  fetchMock.mockReset();
  sentryMessage.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("eraseUser · the local erasure through an injected client", () => {
  it("tombstones the customer, deletes the reminders, then the users row — and says what it did", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };

    const result = await eraseUser(USER_ID, deps());

    expect(h.writes).toEqual([
      "insert erased_customers",
      "delete show_reminders",
      "delete users",
    ]);
    expect(h.inserts).toEqual([
      { table: "erased_customers", values: [{ stripeCustomerId: "cus_dummy" }] },
    ]);
    const reminders = render(h.deletes[0].where);
    expect(reminders.sql).toBe(
      '("show_reminders"."email" = $1 or "show_reminders"."user_id" = $2)',
    );
    expect(reminders.params).toEqual(["someone@example.invalid", USER_ID]);
    expect(render(h.deletes[1].where)).toMatchObject({
      sql: '"users"."id" = $1',
      params: [USER_ID],
    });
    expect(result).toEqual({
      status: "erased",
      reminderRows: 2,
      stripeCustomer: true,
      liveSubscription: false,
      cancelRequested: false,
      stripeSearch: "ok",
      stripeCustomersTombstoned: ["cus_dummy"],
      posthog: { status: "skipped_unconfigured", personIds: [] },
    });
    expect(stripeUpdate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes no tombstone for an account without a Stripe customer", async () => {
    await eraseUser(USER_ID, deps());

    expect(h.writes).toEqual(["delete show_reminders", "delete users"]);
  });

  it("holds the erasure back when the tombstone cannot be written — nothing deleted, the error propagates", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    h.insertFails = new Error("connection reset");

    await expect(eraseUser(USER_ID, deps())).rejects.toThrow("connection reset");
    expect(h.deletes).toEqual([]);
  });

  it("a live subscription is set to cancel at period end through the injected client, with the stated budget", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    h.liveSub = { stripeSubscriptionId: "sub_dummy" };

    const result = await eraseUser(USER_ID, deps());

    expect(stripeUpdate).toHaveBeenCalledWith(
      "sub_dummy",
      { cancel_at_period_end: true },
      { timeout: STRIPE_CANCEL_TIMEOUT_MS, maxNetworkRetries: STRIPE_CANCEL_RETRIES },
    );
    expect(result).toMatchObject({ liveSubscription: true, cancelRequested: true });
    expect(sentryMessage.mock.calls[0][1]).toMatchObject({ level: "info" });
    const live = h.selects.find((s) => s.table === "subscriptions");
    expect(render(live?.where).sql).toBe(
      '("subscriptions"."user_id" = $1 and "subscriptions"."status" in ($2, $3, $4) and "subscriptions"."current_period_end" > $5)',
    );
  });

  it("a client that cannot be built (the script without STRIPE_SECRET_KEY) reads like a Stripe failure: erased, said by id", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    h.liveSub = { stripeSubscriptionId: "sub_dummy" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await eraseUser(USER_ID, {
      ...deps(),
      getStripe: () => {
        throw Object.assign(new Error("STRIPE_SECRET_KEY is not set"), {
          name: "StripeKeyMissing",
        });
      },
    });

    expect(result).toMatchObject({
      status: "erased",
      liveSubscription: true,
      cancelRequested: false,
    });
    expect(h.deletes.map((d) => d.table)).toEqual(["show_reminders", "users"]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("cancel it at Stripe by hand");
    expect(error.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      stripeCustomerId: "cus_dummy",
      stripeSubscriptionId: "sub_dummy",
      error: { name: "StripeKeyMissing", code: undefined, statusCode: undefined },
    });
    expect(sentryMessage.mock.calls[0][1]).toMatchObject({
      level: "error",
      tags: { cancelRequested: "false" },
    });
  });
});

describe("eraseUser · the customers behind the address (#223)", () => {
  // The users row holds ONE customer id; a guest checkout followed by a
  // signed-in purchase left an older one behind that only Stripe knows.
  // Stripe is asked by the address BEFORE the row (and with it the address)
  // is gone, and every id it answers with lands in the SAME insert as the
  // row's own — still ahead of the deletes.

  it("(а) tombstones the row's customer AND every customer Stripe finds for the address — one insert, before the deletes", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_B" };
    stripeSearch.mockResolvedValue({
      data: [{ id: "cus_A" }, { id: "cus_B" }],
      has_more: false,
    });

    const result = await eraseUser(USER_ID, deps());

    expect(stripeSearch).toHaveBeenCalledTimes(1);
    // The address goes as stored (Stripe's exact match is case-insensitive);
    // one page, the cancellation's ceiling, no retries.
    expect(stripeSearch).toHaveBeenCalledWith(
      { query: `email:'${EMAIL}'`, limit: STRIPE_SEARCH_LIMIT },
      { timeout: STRIPE_CANCEL_TIMEOUT_MS, maxNetworkRetries: 0 },
    );
    expect(h.writes).toEqual([
      "insert erased_customers",
      "delete show_reminders",
      "delete users",
    ]);
    expect(h.inserts).toEqual([
      {
        table: "erased_customers",
        values: [{ stripeCustomerId: "cus_B" }, { stripeCustomerId: "cus_A" }],
      },
    ]);
    expect(result).toMatchObject({
      status: "erased",
      stripeSearch: "ok",
      stripeCustomersTombstoned: ["cus_B", "cus_A"],
    });
    expect(sentryMessage).not.toHaveBeenCalled();
  });

  it("tombstones a customer Stripe finds even when the users row holds none", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: null };
    stripeSearch.mockResolvedValue({ data: [{ id: "cus_A" }], has_more: false });

    const result = await eraseUser(USER_ID, deps());

    expect(h.writes[0]).toBe("insert erased_customers");
    expect(h.inserts).toEqual([
      { table: "erased_customers", values: [{ stripeCustomerId: "cus_A" }] },
    ]);
    expect(result).toMatchObject({
      stripeCustomer: false,
      stripeCustomersTombstoned: ["cus_A"],
    });
  });

  it("(б) a failed search (timeout, outage) is `failed`: the erasure completes with the row's id, shouted by id — log AND Sentry, never the address", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_B" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // Stripe echoes the query in its message — the query is the address.
    stripeSearch.mockRejectedValue(
      Object.assign(new Error(`Request timed out: email:'${EMAIL}'`), {
        name: "StripeConnectionError",
        code: "ETIMEDOUT",
      }),
    );

    const result = await eraseUser(USER_ID, deps());

    expect(result).toMatchObject({
      status: "erased",
      stripeSearch: "failed",
      stripeCustomersTombstoned: ["cus_B"],
    });
    expect(h.writes).toEqual([
      "insert erased_customers",
      "delete show_reminders",
      "delete users",
    ]);
    expect(h.inserts).toEqual([
      { table: "erased_customers", values: [{ stripeCustomerId: "cus_B" }] },
    ]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("Stripe customer search FAILED");
    expect(error.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      error: { name: "StripeConnectionError", code: "ETIMEDOUT", statusCode: undefined },
    });
    expect(sentryMessage).toHaveBeenCalledTimes(1);
    expect(sentryMessage.mock.calls[0][0]).toContain("NOT searched");
    expect(sentryMessage.mock.calls[0][1]).toEqual({
      level: "error",
      tags: { userId: USER_ID, stripeSearch: "failed" },
    });
    expect(stepsLeftByHand(result)).toEqual([
      "stripe: the customer search failed — find the address in the Dashboard and tombstone every customer by hand (runbook §4)",
    ]);
  });

  it("(в) a client that cannot be built (no STRIPE_SECRET_KEY) is `skipped_unconfigured`: no request, no alarm, the row's id still tombstoned", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_B" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await eraseUser(USER_ID, {
      ...deps(),
      getStripe: () => {
        throw Object.assign(new Error("STRIPE_SECRET_KEY is not set"), {
          name: "StripeKeyMissing",
        });
      },
    });

    expect(result).toMatchObject({
      status: "erased",
      stripeSearch: "skipped_unconfigured",
      stripeCustomersTombstoned: ["cus_B"],
    });
    expect(stripeSearch).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([
      { table: "erased_customers", values: [{ stripeCustomerId: "cus_B" }] },
    ]);
    expect(error).not.toHaveBeenCalled();
    expect(sentryMessage).not.toHaveBeenCalled();
    expect(stepsLeftByHand(result)).toEqual([]);
  });

  it("(г) the address is escaped for the Stripe Search Query Language — the backslash first, then the quote", async () => {
    h.userRow = { email: "o'brien\\x@example.invalid", stripeCustomerId: null };

    await eraseUser(USER_ID, deps());

    expect(stripeSearch.mock.calls[0][0].query).toBe(
      "email:'o\\'brien\\\\x@example.invalid'",
    );
    expect(escapeStripeSearchValue("a\\'b")).toBe("a\\\\\\'b");
    expect(stripeCustomerSearchQuery("plain@example.invalid")).toBe(
      "email:'plain@example.invalid'",
    );
  });

  it("(д) a second page (has_more) is a warning by id, not a second request — the first page is tombstoned", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: null };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stripeSearch.mockResolvedValue({ data: [{ id: "cus_A" }], has_more: true });

    const result = await eraseUser(USER_ID, deps());

    expect(stripeSearch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      stripeSearch: "ok",
      stripeCustomersTombstoned: ["cus_A"],
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      `more than ${STRIPE_SEARCH_LIMIT} Stripe customers`,
    );
    expect(warn.mock.calls[0][1]).toEqual({ userId: USER_ID });
    expect(sentryMessage).not.toHaveBeenCalled();
  });

  it("is not asked when the users row is already gone — there is no address to search by", async () => {
    h.userRow = undefined;

    await eraseUser(USER_ID, deps());

    expect(stripeSearch).not.toHaveBeenCalled();
  });
});

describe("eraseUser · PostHog (#180)", () => {
  it("is asked AFTER the local rows are gone, and its result rides the info line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    posthogDeletes();

    const result = await eraseUser(USER_ID, { ...deps(), posthog: CFG });

    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete users",
      "posthog GET",
      "posthog DELETE",
    ]);
    expect(result.posthog).toEqual({ status: "deleted", personIds: ["42"] });
    expect(info.mock.calls.at(-1)?.[1]).toMatchObject({
      userId: USER_ID,
      posthog: "deleted",
      posthogPersons: 1,
    });
    expect(sentryMessage).not.toHaveBeenCalled();
  });

  it("is still asked when the users row was already gone — the retry path for a failed first pass", async () => {
    h.userRow = undefined;
    posthogDeletes();

    const result = await eraseUser(USER_ID, { ...deps(), posthog: CFG });

    expect(result).toEqual({
      status: "not_found",
      posthog: { status: "deleted", personIds: ["42"] },
    });
    expect(h.writes).toEqual(["posthog GET", "posthog DELETE"]);
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  it("a key without person:write (403) leaves the local erasure complete and shouts by id — log AND Sentry", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(json(200, { results: [{ id: 42 }] }))
      .mockResolvedValueOnce(json(403, { type: "authentication_error" }));

    const result = await eraseUser(USER_ID, { ...deps(), posthog: CFG });

    expect(result.status).toBe("erased");
    expect(result.posthog).toEqual({
      status: "skipped_forbidden",
      personIds: ["42"],
      httpStatus: 403,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain("PostHog person NOT erased");
    expect(error.mock.calls[0][1]).toEqual({
      userId: USER_ID,
      posthog: "skipped_forbidden",
      personIds: ["42"],
      httpStatus: 403,
      error: undefined,
    });
    expect(sentryMessage).toHaveBeenCalledTimes(1);
    expect(sentryMessage.mock.calls[0][0]).toContain("PostHog person NOT erased");
    expect(sentryMessage.mock.calls[0][1]).toEqual({
      level: "error",
      tags: { userId: USER_ID, posthogStatus: "skipped_forbidden" },
    });
  });

  it("an outage (failed) is reported the same way and changes nothing about the local result", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await eraseUser(USER_ID, { ...deps(), posthog: CFG });

    expect(result).toMatchObject({
      status: "erased",
      reminderRows: 2,
      posthog: { status: "failed", personIds: [] },
    });
    expect(error.mock.calls[0][1]).toMatchObject({
      userId: USER_ID,
      posthog: "failed",
      error: { name: "TypeError" },
    });
    expect(sentryMessage.mock.calls[0][1]).toMatchObject({
      tags: { posthogStatus: "failed" },
    });
  });

  it("without credentials makes no request and raises no alarm", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await eraseUser(USER_ID, deps());

    expect(result.posthog.status).toBe("skipped_unconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(sentryMessage).not.toHaveBeenCalled();
  });
});

describe("previewErasure (the dry run)", () => {
  it("counts every table by the erasure's own predicates and writes nothing", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    h.counts = {
      show_reminders: 3,
      subscriptions: 1,
      watch_progress: 12,
      watch_days: 5,
      trial_sessions: 2,
      visitors: 1,
      marketing_links: 0,
      erased_customers: 1,
    };
    fetchMock.mockResolvedValueOnce(json(200, { results: [{ id: 42 }] }));
    stripeSearch.mockResolvedValue({
      data: [{ id: "cus_dummy" }, { id: "cus_older" }],
      has_more: false,
    });

    const preview = await previewErasure(USER_ID, {
      db: makeDb(),
      getStripe: stripe,
      posthog: CFG,
    });

    expect(preview).toEqual({
      found: true,
      deleted: {
        users: 1,
        show_reminders: 3,
        subscriptions: 1,
        watch_progress: 12,
        watch_days: 5,
      },
      deidentified: { trial_sessions: 2, visitors: 1, marketing_links: 0 },
      stripeCustomer: true,
      tombstoned: true,
      // subscriptions counted twice: all rows, and the live one by the
      // access-granting predicate — the recorder answers 1 to both.
      liveSubscription: true,
      stripeSearch: {
        status: "ok",
        customerIds: ["cus_dummy", "cus_older"],
        hasMore: false,
      },
      posthog: { status: "found", personIds: ["42"] },
    });
    expect(h.writes).toEqual([]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET"]);
    // The same read-only search the erasure runs — the address as stored.
    expect(stripeSearch).toHaveBeenCalledWith(
      { query: `email:'${EMAIL}'`, limit: STRIPE_SEARCH_LIMIT },
      { timeout: STRIPE_CANCEL_TIMEOUT_MS, maxNetworkRetries: 0 },
    );

    const byTable = Object.fromEntries(
      h.selects.map((s) => [
        `${s.table}${(s.fields as { n?: unknown })?.n ? "#count" : ""}`,
        render(s.where),
      ]),
    );
    expect(byTable["show_reminders#count"]).toMatchObject({
      sql: '("show_reminders"."email" = $1 or "show_reminders"."user_id" = $2)',
      params: ["someone@example.invalid", USER_ID],
    });
    expect(byTable["watch_progress#count"]).toMatchObject({
      sql: '"watch_progress"."user_id" = $1',
    });
    expect(byTable["watch_days#count"].sql).toBe('"watch_days"."user_id" = $1');
    expect(byTable["trial_sessions#count"].sql).toBe('"trial_sessions"."user_id" = $1');
    expect(byTable["visitors#count"].sql).toBe('"visitors"."user_id" = $1');
    expect(byTable["marketing_links#count"].sql).toBe('"marketing_links"."created_by" = $1');
    expect(byTable["erased_customers#count"]).toMatchObject({
      sql: '"erased_customers"."stripe_customer_id" = $1',
      params: ["cus_dummy"],
    });
    // subscriptions: the plain count AND the live predicate — both rendered.
    const subs = h.selects
      .filter((s) => s.table === "subscriptions")
      .map((s) => render(s.where).sql);
    expect(subs).toEqual([
      '"subscriptions"."user_id" = $1',
      '("subscriptions"."user_id" = $1 and "subscriptions"."status" in ($2, $3, $4) and "subscriptions"."current_period_end" > $5)',
    ]);
  });

  it("without a users row keys reminders by user_id alone, skips the tombstone read and the Stripe search, and reports found=false", async () => {
    h.userRow = undefined;

    const preview = await previewErasure(USER_ID, {
      db: makeDb(),
      getStripe: stripe,
      posthog: null,
    });

    expect(preview).toMatchObject({
      found: false,
      deleted: { users: 0 },
      stripeCustomer: false,
      tombstoned: false,
      liveSubscription: false,
      stripeSearch: null,
      posthog: { status: "skipped_unconfigured" },
    });
    const reminders = h.selects.find((s) => s.table === "show_reminders");
    expect(render(reminders?.where).sql).toBe('"show_reminders"."user_id" = $1');
    expect(h.selects.some((s) => s.table === "erased_customers")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stripeSearch).not.toHaveBeenCalled();
  });

  it("a failed or unconfigured search is a status in the preview — never a throw, never an alarm (the dry run's stdout is the channel)", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stripeSearch.mockRejectedValue(
      Object.assign(new Error("boom"), { name: "StripeAPIError", statusCode: 503 }),
    );

    const failed = await previewErasure(USER_ID, {
      db: makeDb(),
      getStripe: stripe,
      posthog: null,
    });
    const skipped = await previewErasure(USER_ID, {
      db: makeDb(),
      getStripe: () => {
        throw new Error("STRIPE_SECRET_KEY is not set");
      },
      posthog: null,
    });

    expect(failed.stripeSearch).toEqual({
      status: "failed",
      customerIds: [],
      hasMore: false,
      error: { name: "StripeAPIError", code: undefined, statusCode: 503 },
    });
    expect(skipped.stripeSearch).toEqual({
      status: "skipped_unconfigured",
      customerIds: [],
      hasMore: false,
    });
    expect(h.writes).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(sentryMessage).not.toHaveBeenCalled();
  });
});

describe("the script's stdout", () => {
  const preview: ErasePreview = {
    found: true,
    deleted: { users: 1, show_reminders: 3, subscriptions: 1, watch_progress: 12, watch_days: 5 },
    deidentified: { trial_sessions: 2, visitors: 1, marketing_links: 0 },
    stripeCustomer: true,
    tombstoned: false,
    liveSubscription: true,
    stripeSearch: {
      status: "ok",
      customerIds: ["cus_dummy", "cus_older"],
      hasMore: false,
    },
    posthog: { status: "skipped_forbidden", personIds: [], httpStatus: 403 },
  };

  it("the dry run prints the id, counts and statuses — one line per fact", () => {
    expect(summarizeErasePreview(USER_ID, preview)).toBe(
      [
        "subject: user_2abc",
        "would delete: users=1 show_reminders=3 subscriptions=1 watch_progress=12 watch_days=5",
        "would de-identify (user_id → NULL): trial_sessions=2 visitors=1 marketing_links=0",
        "stripe: customer=yes live_subscription=yes (would be set to cancel at period end) search=ok customers=2 (ids cus_dummy, cus_older)",
        "posthog: skipped_forbidden http=403",
      ].join("\n"),
    );
    expect(
      summarizeErasePreview(USER_ID, {
        ...preview,
        found: false,
        tombstoned: true,
        liveSubscription: false,
        posthog: {
          status: "failed",
          personIds: [],
          error: { name: "TimeoutError" },
        },
      }),
    ).toContain(
      "subject: user_2abc (no users row — already erased or never mirrored)\n",
    );
    expect(
      summarizeErasePreview(USER_ID, { ...preview, tombstoned: true, liveSubscription: false }),
    ).toContain("stripe: customer=yes (tombstoned) live_subscription=no");
    // The search's scope, by status: ids only, never the address.
    const stripeLine = (search: ErasePreview["stripeSearch"]) =>
      summarizeErasePreview(USER_ID, { ...preview, liveSubscription: false, stripeSearch: search })
        .split("\n")[3];
    expect(stripeLine(null)).toBe("stripe: customer=yes live_subscription=no");
    expect(stripeLine({ status: "ok", customerIds: [], hasMore: false })).toBe(
      "stripe: customer=yes live_subscription=no search=ok customers=0",
    );
    expect(stripeLine({ status: "ok", customerIds: ["cus_a"], hasMore: true })).toBe(
      "stripe: customer=yes live_subscription=no search=ok customers=1 (ids cus_a) has_more=yes (first 100 only)",
    );
    expect(
      stripeLine({
        status: "failed",
        customerIds: [],
        hasMore: false,
        error: { name: "TimeoutError" },
      }),
    ).toBe("stripe: customer=yes live_subscription=no search=failed error=TimeoutError");
    expect(
      stripeLine({ status: "skipped_unconfigured", customerIds: [], hasMore: false }),
    ).toBe("stripe: customer=yes live_subscription=no search=skipped_unconfigured");
    expect(
      summarizeErasePreview(USER_ID, {
        ...preview,
        posthog: { status: "found", personIds: ["42", "43"] },
      }),
    ).toContain("posthog: found persons=2");
  });

  it("the apply summary names what was erased and what is left by hand", () => {
    const erased: EraseUserResult = {
      status: "erased",
      reminderRows: 2,
      stripeCustomer: true,
      liveSubscription: true,
      cancelRequested: false,
      stripeSearch: "ok",
      stripeCustomersTombstoned: ["cus_dummy", "cus_older"],
      posthog: { status: "failed", personIds: ["42"], error: { name: "TimeoutError" } },
    };
    expect(summarizeEraseResult(USER_ID, erased)).toBe(
      [
        "subject: user_2abc",
        "local: erased (show_reminders=2, users=1 + cascades)",
        "stripe: customer=tombstoned live_subscription=NOT cancelled — cancel by hand search=ok tombstoned customers=2 (ids cus_dummy, cus_older)",
        "posthog: failed persons=1 error=TimeoutError",
      ].join("\n"),
    );
    expect(stepsLeftByHand(erased)).toEqual([
      "stripe: cancel the live subscription by hand",
      "posthog: delete the person by hand (runbook §4)",
    ]);

    // A failed search is a hand step of its own, between the two above —
    // the address is gone with the row, so no script re-run can repeat it.
    const unsearched: EraseUserResult = {
      ...erased,
      stripeSearch: "failed",
      stripeCustomersTombstoned: ["cus_dummy"],
    };
    expect(summarizeEraseResult(USER_ID, unsearched)).toContain(
      "search=failed tombstoned customers=1 (ids cus_dummy)",
    );
    expect(stepsLeftByHand(unsearched)).toEqual([
      "stripe: cancel the live subscription by hand",
      "stripe: the customer search failed — find the address in the Dashboard and tombstone every customer by hand (runbook §4)",
      "posthog: delete the person by hand (runbook §4)",
    ]);

    const clean: EraseUserResult = {
      ...erased,
      cancelRequested: true,
      stripeCustomersTombstoned: ["cus_dummy"],
      posthog: { status: "deleted", personIds: ["42"] },
    };
    expect(summarizeEraseResult(USER_ID, clean)).toContain(
      "search=ok tombstoned customers=1 (ids cus_dummy)\n",
    );
    expect(summarizeEraseResult(USER_ID, clean)).toContain(
      "live_subscription=cancel at period end requested",
    );
    expect(stepsLeftByHand(clean)).toEqual([]);

    const gone: EraseUserResult = {
      status: "not_found",
      posthog: { status: "not_found", personIds: [] },
    };
    expect(summarizeEraseResult(USER_ID, gone)).toBe(
      "subject: user_2abc\nlocal: nothing to erase (no users row)\nposthog: not_found",
    );
    expect(stepsLeftByHand(gone)).toEqual([]);
    expect(
      stepsLeftByHand({
        status: "not_found",
        posthog: { status: "skipped_forbidden", personIds: [], httpStatus: 401 },
      }),
    ).toEqual(["posthog: delete the person by hand (runbook §4)"]);
  });
});

describe("parseEraseArgs", () => {
  it("needs a user id, and is a dry run unless told --apply", () => {
    expect(parseEraseArgs([])).toMatchObject({ ok: false, reason: "missing_user_id" });
    expect(parseEraseArgs(["user_2abc"])).toEqual({
      ok: true,
      userId: "user_2abc",
      apply: false,
    });
    expect(parseEraseArgs(["user_2abc", "--apply"])).toEqual({
      ok: true,
      userId: "user_2abc",
      apply: true,
    });
    expect(parseEraseArgs(["--apply", "user_2abc"])).toMatchObject({ apply: true });
  });

  it("refuses an unknown flag, a second positional and an id that is not a Clerk id", () => {
    expect(parseEraseArgs(["user_2abc", "--force"])).toMatchObject({
      ok: false,
      reason: "unknown_argument",
    });
    expect(parseEraseArgs(["user_2abc", "user_other"])).toMatchObject({
      ok: false,
      reason: "unknown_argument",
    });
    expect(parseEraseArgs(["user@example.invalid"])).toMatchObject({
      ok: false,
      reason: "invalid_user_id",
    });
  });

  it("the usage text says it is a dry run by default and reads no .env.local", () => {
    expect(ERASE_USAGE).toContain("[--apply]");
    expect(ERASE_USAGE).toContain("changes nothing");
    expect(ERASE_USAGE).toContain("Nothing is read from .env.local");
  });
});
