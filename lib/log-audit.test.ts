import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sentryPrivacyOptions, type SentryEventLike } from "./observability";

// ТЕСТ-АУДИТ ЛОГОВ.
//
// The privacy rule in CLAUDE.md ("user data never reaches logs, the error
// tracker or analytics — only ids, statuses and durations") is a sentence
// somebody has to remember. This file is the machine that remembers it: it
// seeds recognisable user text into the paths that report failures and asserts
// the text does not come out the other end.
//
// It is meant to GROW. A new server path that logs, or a new field on the
// Sentry payload, gets a case here in the same PR — that is the deal recorded
// in CLAUDE.md.

// Markers are deliberately unmistakable and obviously fake (a real-looking
// secret here would be flagged by the nightly gitleaks scan).
const MARKER_EMAIL = "leak.marker@example.invalid";
const MARKER_NAME = "Leak Marker";
const MARKER_SECRET = "dummy-db-password";
const MARKER_DATABASE_URL = `postgres://matio:${MARKER_SECRET}@db.example.invalid/matio`;

const {
  execute,
  select,
  update,
  del,
  insert,
  batchSend,
  clerkVerify,
  stripeUpdate,
  erasedCustomer,
  sentryMessage,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  insert: vi.fn(),
  batchSend: vi.fn(),
  clerkVerify: vi.fn(),
  stripeUpdate: vi.fn(),
  erasedCustomer: vi.fn(),
  sentryMessage: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { execute, select, update, delete: del, insert } }));
vi.mock("server-only", () => ({}));
// Sentry is the second sink these paths report to (the Clerk erasure and the
// retention cron both send a message with tags). Spied so the audit can read
// what would leave the process — the scrubbers in lib/observability.ts are
// exercised separately above; here the question is what the CALL carries.
vi.mock("@sentry/nextjs", () => ({ captureMessage: sentryMessage }));

// The erasure handler's one outbound call (cancel the live subscription at
// Stripe) is a spy so its failure text can be seeded with a marker.
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { update: stripeUpdate } }),
}));
// The Stripe mirror's guest branch: the tombstone answer is the switch under
// audit; the claim itself must never be reached from a tombstoned customer.
vi.mock("@/lib/guest-checkout", () => ({
  isGuestSubscription: (sub: { metadata?: Record<string, string> }) =>
    (sub.metadata ?? {}).guest === "1",
  isErasedCustomer: erasedCustomer,
  claimGuestCheckout: async () => {
    throw new Error("claim must not run for an erased customer");
  },
}));

// The Clerk webhook's signature check is exercised in its own suite
// (app/api/webhooks/clerk/route.test.ts); here the event is handed over
// verified so the audit sees only what the handler itself logs.
vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: clerkVerify }));
// The app's progress route resolves the caller through Clerk; a fixed user
// keeps the audit on the path that actually reaches the database.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: "user_1" }),
}));

// The reminder dispatch path pulls in auth, Next's cache and the Resend SDK —
// none of which is the thing under audit. Everything except the action's own
// logging is stubbed to inert values.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => ({ id: "admin_1" }),
}));
vi.mock("@/lib/resend", () => ({
  resendConfigured: () => true,
  getResend: () => ({ batch: { send: batchSend } }),
  emailFrom: () => "Matio <updates@example.invalid>",
  emailReplyTo: () => "contact@example.invalid",
}));
vi.mock("@/lib/email-unsubscribe", () => ({
  unsubscribeUrls: () => ({
    page: "https://matio.tv/unsubscribe?token=dummy",
    oneClick: "https://matio.tv/api/email/unsubscribe?token=dummy",
  }),
}));
vi.mock("@/lib/reminder-email", () => ({
  renderShowReminderEmail: () => ({ subject: "s", html: "<p>s</p>", text: "s" }),
}));
vi.mock("@/lib/mux-token", () => ({
  muxThumbnailUrl: () => "https://image.mux.com/dummy/thumbnail.jpg",
}));

import { sendShowReminders } from "@/app/admin/reminder-actions";
import { GET as retentionCron } from "@/app/api/cron/retention/route";
import { GET as readyz } from "@/app/api/readyz/route";
import { POST as clerkWebhook } from "@/app/api/webhooks/clerk/route";
import { POST as saveProgress } from "@/app/api/v1/progress/route";
import { POST as saveSegments } from "@/app/api/v1/watch-segments/route";
import { mirrorSubscription } from "@/lib/subscription-mirror";
import { assembleUserExport, summarizeExport } from "@/lib/user-export";

/** Render a console argument the way a log aggregator would see it. */
function render(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.message} ${value.stack ?? ""}`;
  try {
    return (
      JSON.stringify(value, (_key, item) =>
        item instanceof Error ? `${item.name}: ${item.message}` : item,
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

/** Capture everything the code under test writes to any console channel. */
function captureConsole() {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  for (const method of methods) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(render).join(" "));
    });
  }
  return () => lines.join("\n");
}

beforeEach(() => {
  execute.mockReset();
  select.mockReset();
  update.mockReset();
  del.mockReset();
  insert.mockReset();
  stripeUpdate.mockReset();
  batchSend.mockReset();
  clerkVerify.mockReset();
  stripeUpdate.mockReset().mockResolvedValue({ id: "sub_dummy" });
  erasedCustomer.mockReset().mockResolvedValue(false);
  sentryMessage.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("log audit · the detector itself", () => {
  it("sees a marker that really is written to the console", () => {
    // Without this case every assertion below could pass because the capture
    // is broken rather than because nothing leaked.
    const logged = captureConsole();

    console.error("seeded", { email: MARKER_EMAIL });

    expect(logged()).toContain(MARKER_EMAIL);
  });
});

describe("log audit · Sentry payloads", () => {
  function seededEvent(): SentryEventLike {
    return {
      message: `reminder dispatch failed for ${MARKER_EMAIL}`,
      transaction: `GET /unsubscribe?token=${MARKER_SECRET}`,
      request: {
        url: `https://matio.tv/unsubscribe?email=${MARKER_EMAIL}`,
        query_string: `email=${MARKER_EMAIL}`,
        cookies: { trial_session: MARKER_SECRET },
        headers: {
          Cookie: `__session=${MARKER_SECRET}`,
          Authorization: `Bearer ${MARKER_SECRET}`,
          "User-Agent": "Mozilla/5.0",
        },
        data: { email: MARKER_EMAIL, name: MARKER_NAME },
      },
      user: { id: "user_1", email: MARKER_EMAIL, username: MARKER_NAME } as {
        id?: string;
      },
      breadcrumbs: [
        { category: "console", message: `subscriber ${MARKER_EMAIL}` },
        { category: "fetch", data: { url: `/api/t?email=${MARKER_EMAIL}` } },
      ],
      exception: { values: [{ value: `no row for ${MARKER_EMAIL}` }] },
    };
  }

  it("carries every marker before scrubbing", () => {
    // The fixture has to be dirty, or the next test proves nothing.
    const raw = JSON.stringify(seededEvent());

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET]) {
      expect(raw).toContain(marker);
    }
  });

  it("lets none of them through beforeSend", () => {
    const scrubbed = JSON.stringify(sentryPrivacyOptions().beforeSend(seededEvent()));

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET]) {
      expect(scrubbed).not.toContain(marker);
    }
  });

  it("lets none of them through beforeSendTransaction", () => {
    const scrubbed = JSON.stringify(
      sentryPrivacyOptions().beforeSendTransaction(seededEvent()),
    );

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET]) {
      expect(scrubbed).not.toContain(marker);
    }
  });
});

describe("log audit · /api/readyz", () => {
  it("logs the failure without the connection string or the driver's message", async () => {
    // The realistic worst case: the driver puts the whole URL it failed to
    // reach into the error it throws.
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    execute.mockRejectedValue(
      new Error(`could not connect to ${MARKER_DATABASE_URL}`),
    );
    const logged = captureConsole();

    const res = await readyz();

    expect(res.status).toBe(503);
    expect(logged()).not.toContain(MARKER_SECRET);
    expect(logged()).not.toContain("db.example.invalid");
    // What it DOES log: a reason code, which is the whole point of the rule.
    expect(logged()).toContain("unavailable");
  });

  it("keeps the connection string out of the response body too", async () => {
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    execute.mockRejectedValue(new Error(`bad password for ${MARKER_SECRET}`));
    captureConsole();

    const body = JSON.stringify(await (await readyz()).json());

    expect(body).not.toContain(MARKER_SECRET);
    expect(body).not.toContain("db.example.invalid");
  });
});

describe("log audit · /api/cron/retention (the daily deletion run)", () => {
  const cronRequest = () =>
    new Request("https://matio.tv/api/cron/retention", {
      headers: { authorization: "Bearer dummy-cron-secret" },
    });

  it("logs a failed table by name, SQLSTATE and class — never the statement the driver quoted", async () => {
    vi.stubEnv("CRON_SECRET", "dummy-cron-secret");
    // The realistic worst case: the driver's error carries the row it choked
    // on (a subscriber's address) and the URL it was talking to — on BOTH
    // levels of Drizzle's wrapper, since the outer message repeats the query.
    const driverText = `DELETE failed on row {email: ${MARKER_EMAIL}} at ${MARKER_DATABASE_URL}`;
    const cause = Object.assign(new Error(driverText), {
      name: "PostgresError",
      code: "42P01",
    });
    execute.mockRejectedValue(
      Object.assign(new Error(`Failed query: ${driverText}`), {
        name: "DrizzleQueryError",
        cause,
      }),
    );
    const logged = captureConsole();

    const res = await retentionCron(cronRequest());
    const body = JSON.stringify(await res.json());
    const sentry = JSON.stringify(sentryMessage.mock.calls);

    expect(res.status).toBe(500);
    expect(sentryMessage).toHaveBeenCalled(); // the fixture reached the second sink
    for (const marker of [MARKER_EMAIL, MARKER_SECRET, "db.example.invalid"]) {
      expect(logged()).not.toContain(marker);
      expect(body).not.toContain(marker);
      expect(sentry).not.toContain(marker);
    }
    // What it DOES log, answer and send: which table, the driver's SQLSTATE,
    // the error's class, and how far it got — enough to tell a missing table
    // from a deadlock from a timeout without a single quoted value.
    expect(logged()).toContain("trial_sessions");
    expect(logged()).toContain("42P01");
    expect(logged()).toContain("DrizzleQueryError");
    expect(sentry).toContain('"code":"42P01"');
    expect(body).toContain('"failed":[');
    expect(body).toContain('"trial_sessions"');
  });
});

describe("log audit · reminder dispatch (Resend)", () => {
  // The realistic worst case Resend produces: both the per-item reject and
  // the batch-level error quote the address they refused verbatim.
  const REJECTED_ROW_ID = "rem_rejected_row";

  /** The target-episode lookup: chainable, resolves when awaited. */
  function selectChain(rows: unknown[]) {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      for: () => chain,
      then: (
        onFulfilled?: (value: unknown[]) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  }

  /** A claim/un-claim UPDATE: awaitable directly or via .returning(). */
  function updateChain(returningRows: unknown[]) {
    const settled = Object.assign(Promise.resolve(undefined), {
      returning: () => Promise.resolve(returningRows),
    });
    return { set: () => ({ where: () => settled }) };
  }

  const target = {
    episodeNumber: 2,
    episodeTitle: "Episode two",
    episodeDescription: null,
    episodeDuration: 300,
    muxPlaybackId: null,
    muxPlaybackPolicy: "signed",
    seasonNumber: 1,
    showTitle: "Show",
    showSlug: "show",
    showGenre: null,
  };

  function dispatchFormData() {
    const formData = new FormData();
    formData.set("showId", "show_1");
    formData.set("episodeId", "ep_1");
    return formData;
  }

  it("logs a per-item reject without the subscriber's address", async () => {
    select.mockImplementation(() => selectChain([target]));
    update.mockImplementationOnce(() =>
      updateChain([
        { id: "rem_ok_row", email: "ok@example.invalid", locale: "en" },
        { id: REJECTED_ROW_ID, email: MARKER_EMAIL, locale: "en" },
      ]),
    );
    update.mockImplementationOnce(() => updateChain([]));
    const rejectMessage = `Invalid \`to\` field: ${MARKER_EMAIL} is not a valid email address`;
    expect(rejectMessage).toContain(MARKER_EMAIL); // the fixture must be dirty
    batchSend.mockResolvedValue({
      data: { data: [{ id: "email_1" }], errors: [{ index: 1, message: rejectMessage }] },
      error: null,
    });
    const logged = captureConsole();

    const result = await sendShowReminders({ status: "idle" }, dispatchFormData());

    expect(result).toEqual({ status: "ok", sent: 1 });
    expect(logged()).not.toContain(MARKER_EMAIL);
    // What it DOES log: the show_reminders row id — enough for manual repair.
    expect(logged()).toContain(REJECTED_ROW_ID);
  });

  it("logs a failed batch send without the subscriber's address", async () => {
    select.mockImplementation(() => selectChain([target]));
    update.mockImplementationOnce(() =>
      updateChain([{ id: REJECTED_ROW_ID, email: MARKER_EMAIL, locale: "en" }]),
    );
    // The un-claim UPDATE after the failure.
    update.mockImplementationOnce(() => updateChain([]));
    batchSend.mockResolvedValue({
      data: null,
      error: {
        name: "application_error",
        message: `Unable to send to ${MARKER_EMAIL}`,
      },
    });
    const logged = captureConsole();

    const result = await sendShowReminders({ status: "idle" }, dispatchFormData());

    expect(result).toEqual({ status: "error", code: "send_failed", sent: 0 });
    expect(logged()).not.toContain(MARKER_EMAIL);
    // What it DOES log: the vendor's error code, which is id/status territory.
    expect(logged()).toContain("application_error");
  });
});

describe("log audit · Clerk user.deleted (account erasure)", () => {
  // The worst case this path logs: the deleted account still has a live
  // Stripe subscription, so the handler shouts — and the users row it just
  // read carries the address. Only ids may come out.
  const USER_ID = "user_marker";

  function selectChain(rows: unknown[]) {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    return chain;
  }

  function deleteChain(returningRows: unknown[]) {
    return {
      where: () =>
        Object.assign(Promise.resolve(undefined), {
          returning: async () => returningRows,
        }),
    };
  }

  function insertChain() {
    return { values: () => ({ onConflictDoNothing: async () => undefined }) };
  }

  function deletedWithLiveSubscription() {
    clerkVerify.mockResolvedValue({
      type: "user.deleted",
      object: "event",
      data: { id: USER_ID, object: "user", deleted: true },
    });
    select
      .mockImplementationOnce(() =>
        selectChain([{ email: MARKER_EMAIL, stripeCustomerId: "cus_dummy" }]),
      )
      .mockImplementationOnce(() =>
        selectChain([{ stripeSubscriptionId: "sub_dummy" }]),
      );
    insert.mockImplementation(insertChain);
    del.mockImplementation(() => deleteChain([{ id: "rem_1" }]));
    return new Request("https://matio.tv/api/webhooks/clerk", {
      method: "POST",
    }) as never;
  }

  it("erases an account with a live subscription without logging its address", async () => {
    const req = deletedWithLiveSubscription();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(logged()).not.toContain(MARKER_EMAIL);
    // What it DOES log: the ids that tie the Stripe-side record together.
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain("sub_dummy");
  });

  it("does not echo Stripe's error text when the cancellation fails", async () => {
    // Stripe quotes request parameters in its messages; seed the address
    // there so a naive `err.message` in the log would be caught.
    stripeUpdate.mockRejectedValue(
      Object.assign(new Error(`No such customer: ${MARKER_EMAIL}`), {
        name: "StripeInvalidRequestError",
        code: "resource_missing",
        statusCode: 404,
      }),
    );
    const req = deletedWithLiveSubscription();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(logged()).toContain("sub_dummy");
    expect(logged()).toContain("resource_missing");
  });
});

describe("log audit · Stripe mirror refusing an erased customer", () => {
  it("logs the refusal by ids, not by the customer's address", async () => {
    // A webhook payload carries the customer expanded — with the email —
    // and the users lookup finds nothing (erased). The refusal line is the
    // only thing this path writes.
    select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }));
    erasedCustomer.mockResolvedValue(true);
    const logged = captureConsole();

    await mirrorSubscription({
      id: "sub_marker",
      object: "subscription",
      status: "active",
      metadata: { guest: "1", userId: "user_marker" },
      customer: {
        id: "cus_marker",
        object: "customer",
        email: MARKER_EMAIL,
        name: MARKER_NAME,
      },
      items: { data: [] },
    } as never);

    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(logged()).not.toContain(MARKER_NAME);
    expect(logged()).toContain("cus_marker");
    expect(logged()).toContain("sub_marker");
  });
});


describe("log audit · /api/v1/progress (the app's watch-progress save)", () => {
  // The body is client-controlled text headed for a uuid column; the
  // realistic worst case is a client that puts something personal where an
  // id belongs, and a driver error that quotes what it choked on.
  const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  function post(body: unknown): Parameters<typeof saveProgress>[0] {
    return { headers: new Headers(), json: async () => body } as unknown as Parameters<
      typeof saveProgress
    >[0];
  }

  it("rejects a body carrying user text without echoing it anywhere", async () => {
    const logged = captureConsole();

    const res = await saveProgress(
      post({ episodeId: MARKER_EMAIL, positionSeconds: 10, completed: false }),
    );

    expect(res.status).toBe(400);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(JSON.stringify(await res.json())).not.toContain(MARKER_EMAIL);
    expect(select).not.toHaveBeenCalled();
  });

  it("lets a database failure surface without logging what the driver quoted", async () => {
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    select.mockImplementation(() => {
      throw new Error(`could not connect to ${MARKER_DATABASE_URL}`);
    });
    const logged = captureConsole();

    await expect(
      saveProgress(post({ episodeId: EPISODE, positionSeconds: 10, completed: false })),
    ).rejects.toThrow();

    // The route itself writes nothing to the console — the failure is the
    // framework's to report, through the Sentry scrubbers audited above.
    expect(logged()).not.toContain(MARKER_SECRET);
    expect(logged()).not.toContain("db.example.invalid");
  });

  it("lets a failed WRITE surface without logging the row the driver quoted", async () => {
    // The lookup succeeds and the upsert itself fails — the postgres driver
    // echoes the statement it choked on, values included. A seeded identity
    // in that echo must not reach the console any more than the URL did.
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    const lookup = {
      from: () => lookup,
      innerJoin: () => lookup,
      where: () => lookup,
      limit: async () => [
        { id: EPISODE, showId: "show_1", access: "free", durationSeconds: 600 },
      ],
    };
    select.mockImplementation(() => lookup);
    insert.mockImplementation(() => {
      throw new Error(
        `insert into watch_progress (user_id, episode_id) values ('${MARKER_NAME} <${MARKER_EMAIL}>', '${EPISODE}') — ${MARKER_DATABASE_URL}`,
      );
    });
    const logged = captureConsole();

    await expect(
      saveProgress(post({ episodeId: EPISODE, positionSeconds: 10, completed: false })),
    ).rejects.toThrow();

    expect(insert).toHaveBeenCalled(); // the fixture reached the write
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET, "db.example.invalid"]) {
      expect(logged()).not.toContain(marker);
    }
  });
});

describe("log audit · /api/v1/watch-segments (the app's retention flush)", () => {
  // Same threat model as the progress save — client text where an id
  // belongs, a driver that quotes the row — plus the ONE place this path
  // logs on its own: a failed progress credit after the counter landed.
  const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  function post(body: unknown): Parameters<typeof saveSegments>[0] {
    return { headers: new Headers(), json: async () => body } as unknown as Parameters<
      typeof saveSegments
    >[0];
  }

  const lookup = {
    from: () => lookup,
    innerJoin: () => lookup,
    where: () => lookup,
    limit: async () => [{ id: EPISODE, showId: "show_1", access: "free", durationSeconds: 600 }],
  };

  it("rejects a body carrying user text without echoing it anywhere", async () => {
    const logged = captureConsole();

    const res = await saveSegments(post({ episodeId: MARKER_EMAIL, buckets: [1] }));

    expect(res.status).toBe(400);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(JSON.stringify(await res.json())).not.toContain(MARKER_EMAIL);
    expect(select).not.toHaveBeenCalled();
  });

  it("lets a failed counter upsert surface without logging the row the driver quoted", async () => {
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    select.mockImplementation(() => lookup);
    insert.mockImplementation(() => {
      throw new Error(
        `insert into watch_segments (episode_id, day, bucket) values ('${EPISODE}', '${MARKER_NAME} <${MARKER_EMAIL}>', 1) — ${MARKER_DATABASE_URL}`,
      );
    });
    const logged = captureConsole();

    await expect(saveSegments(post({ episodeId: EPISODE, buckets: [1] }))).rejects.toThrow();

    expect(insert).toHaveBeenCalled(); // the fixture reached the counter write
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET, "db.example.invalid"]) {
      expect(logged()).not.toContain(marker);
    }
  });

  it("logs a failed progress credit by ids only — never the statement the driver quoted", async () => {
    // The counter landed; the credit fell over. The route answers 200 (a
    // retry would inflate views) and writes ONE warning — which must carry
    // the ids and nothing the driver echoed.
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    select.mockImplementation(() => lookup);
    insert.mockImplementation(() => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }));
    update.mockImplementation(() => ({
      set: () => ({
        where: async () => {
          throw new Error(
            `update watch_progress set total_watched_seconds = 30 where user_id = '${MARKER_NAME} <${MARKER_EMAIL}>' — ${MARKER_DATABASE_URL}`,
          );
        },
      }),
    }));
    const logged = captureConsole();

    const res = await saveSegments(post({ episodeId: EPISODE, buckets: [1, 2, 3] }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, accepted: 3 });
    expect(update).toHaveBeenCalled(); // the fixture reached the credit
    expect(logged()).toContain(EPISODE); // the id IS logged — that is the point of the line
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET, "db.example.invalid"]) {
      expect(logged()).not.toContain(marker);
    }
  });
});

describe("log audit · Stripe subscription mirror (CAPI identity scrub, #165)", () => {
  // The one place the project holds a raw IP: the Purchase snapshot in the
  // subscription's Stripe metadata, erased right after the event. The worst
  // case this path logs is the erase itself failing with an error that quotes
  // the request — values included — while the users row it just read carries
  // the address. Only the subscription id may come out.
  const MARKER_IP = "203.0.113.77";
  const MARKER_UA = "Mozilla/5.0 (LeakMarker; rv:1.0)";
  const SUB_ID = "sub_marker";

  function selectChain(rows: unknown[]) {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => rows,
    };
    return chain;
  }

  it("logs a failed scrub by subscription id only — never the IP, the UA or the address", async () => {
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly_dummy");
    select
      .mockImplementationOnce(() => selectChain([{ id: "user_1", email: MARKER_EMAIL }]))
      .mockImplementationOnce(() => selectChain([])); // no prior row: the Purchase moment
    insert.mockImplementation(() => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    }));
    update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }));
    const stripeMessage = `Invalid metadata on ${SUB_ID}: capi_ip=${MARKER_IP} capi_ua=${MARKER_UA}`;
    expect(stripeMessage).toContain(MARKER_IP); // the fixture must be dirty
    stripeUpdate.mockRejectedValue(new Error(stripeMessage));
    const logged = captureConsole();

    await mirrorSubscription({
      id: SUB_ID,
      customer: "cus_marker",
      status: "active",
      trial_start: null,
      cancel_at_period_end: false,
      cancel_at: null,
      metadata: { capi_consent: "1", capi_ip: MARKER_IP, capi_ua: MARKER_UA },
      items: {
        data: [
          {
            price: { id: "price_monthly_dummy", unit_amount: 3800, currency: "usd" },
            current_period_end: 1_900_000_000,
          },
        ],
      },
    } as never);

    expect(stripeUpdate).toHaveBeenCalledTimes(1); // the fixture reached the scrub
    for (const marker of [MARKER_IP, MARKER_UA, MARKER_EMAIL]) {
      expect(logged()).not.toContain(marker);
    }
    // What it DOES log: the subscription id, enough to re-run the sweep by hand.
    expect(logged()).toContain(SUB_ID);
  });
});

describe("log audit · subject-access export summary (scripts/export-user-data.ts, #163)", () => {
  // The export FILE is the person's data by definition — the address, the
  // name, the billing address are supposed to be in it. What the script
  // prints to the operator's terminal (and what lands in a shell log) is
  // the summary, and that may carry counts and ids only. Two worst cases:
  // a full export where every vendor answered, and a run where every vendor
  // failed with an error that quotes the address back.
  const MARKER_STREET = "42 Leak Marker Street";
  const USER_ID = "user_marker";

  function seededRows() {
    return {
      users: [
        {
          id: USER_ID,
          email: MARKER_EMAIL,
          role: "user",
          stripeCustomerId: "cus_marker",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          signupOrigin: "clerk_signup",
          country: "ES",
          attributionFirstSource: null,
          attributionFirstMedium: null,
          attributionFirstCampaign: null,
          attributionLastSource: null,
          attributionLastMedium: null,
          attributionLastCampaign: null,
        },
      ],
      subscriptions: [],
      watch_progress: [],
      watch_days: [],
      trial_sessions: [],
      visitors: [],
      visitor_days: [],
      show_reminders: [{ id: "rem_marker", email: MARKER_EMAIL }],
    } as unknown as Parameters<typeof assembleUserExport>[0]["rows"];
  }

  it("summarises a full export by counts and ids — never the address, the name or the street", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: seededRows(),
      clients: {
        clerk: {
          users: {
            getUser: async () => ({
              id: USER_ID,
              emailAddresses: [{ emailAddress: MARKER_EMAIL, verification: { status: "verified" } }],
              firstName: "Leak",
              lastName: "Marker",
              createdAt: 1,
              lastSignInAt: null,
            }),
          },
        },
        stripe: {
          customers: {
            retrieve: async (id) => ({
              id,
              email: MARKER_EMAIL,
              name: MARKER_NAME,
              address: { line1: MARKER_STREET, city: "Madrid", country: "ES" },
              created: 1,
            }),
          },
          invoices: {
            list: async function* () {
              yield { id: "in_marker", number: "0001", currency: "usd", status: "paid" };
            },
          },
        },
        posthog: {
          runHogQL: async (query) =>
            query.startsWith("SELECT event,")
              ? [["$pageview", "t", JSON.stringify({ $current_url: `https://matio.tv/?email=${MARKER_EMAIL}` })]]
              : [["person-marker", "t", true, JSON.stringify({ email: MARKER_EMAIL, name: MARKER_NAME })]],
        },
      },
    });
    // The document itself has to be dirty, or the summary check proves nothing.
    const document = JSON.stringify(result);
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_STREET]) {
      expect(document).toContain(marker);
    }

    const summary = summarizeExport(result);

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_STREET, "Leak"]) {
      expect(summary).not.toContain(marker);
    }
    // What it DOES print: the subject id and the counts.
    expect(summary).toContain(USER_ID);
    expect(summary).toContain("show_reminders=1");
    expect(summary).toContain("stripe=received (invoices=1)");
  });

  it("keeps a vendor's error text out of the notes and the summary", async () => {
    // Clerk and Stripe quote request parameters in their messages; a naive
    // `err.message` in a note would put the address into the file's notes
    // AND onto the terminal.
    const quoted = (name: string) =>
      Object.assign(new Error(`No such customer for ${MARKER_NAME} <${MARKER_EMAIL}>`), {
        name,
        statusCode: 404,
      });
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: seededRows(),
      clients: {
        clerk: { users: { getUser: async () => { throw quoted("ClerkAPIResponseError"); } } },
        stripe: {
          customers: { retrieve: async () => { throw quoted("StripeInvalidRequestError"); } },
          invoices: { list: async function* () {} },
        },
        posthog: { runHogQL: async () => { throw quoted("Error"); } },
      },
    });

    expect(result.processors).toEqual({ clerk: null, stripe: null, posthog: null });
    const notes = result.notes.join("\n");
    const summary = summarizeExport(result);
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(notes).not.toContain(marker);
      expect(summary).not.toContain(marker);
    }
    // What it DOES keep: the error's name and status, enough to know what to retry.
    expect(notes).toContain("StripeInvalidRequestError/404");
  });
});
