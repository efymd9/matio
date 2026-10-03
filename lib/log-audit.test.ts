import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
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
// Free text a fan wrote (the /ideas story, #297) — the one marker that is
// not an identifier but a person's own words.
const MARKER_STORY = "Storymarker: the banished postman delivers his last letter";
// The anonymous identity (the app's device UUID, the web's trial cookie) and the
// HMAC of the viewer's IP — what a failed trial_sessions statement binds, and
// so what Drizzle's error quotes after `params:` (#305, #326).
const MARKER_IDENTITY = "1eaf0000-dead-4bee-8f00-00000000beef";
const MARKER_IP_HASH = "dummy-ip-hash-leak-marker";

const {
  execute,
  select,
  update,
  del,
  insert,
  batchSend,
  clerkVerify,
  stripeUpdate,
  stripeSearch,
  stripeSessionList,
  stripeSessionExpire,
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
  stripeSearch: vi.fn(),
  stripeSessionList: vi.fn(),
  stripeSessionExpire: vi.fn(),
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

// The erasure handler's two outbound calls (cancel the live subscription at
// Stripe; find every customer for the address, #223) are spies so their
// failure text and their answers can be seeded with a marker.
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { update: stripeUpdate, list: async () => ({ data: [] }) },
    // The checkout session builder's calls (#214): inert, so the audit case
    // reaches the CAPI identity capture it exists to watch. The one-open-
    // session sweep that follows every create (#217) is spied, so its failure
    // text can be seeded with a marker. `search` is the erasure's customer
    // lookup by address (#223) — a spy for the same reason.
    customers: { create: async () => ({ id: "cus_dummy" }), search: stripeSearch },
    checkout: {
      sessions: {
        create: async () => ({
          id: "cs_test_dummy",
          client_secret: "cs_secret_dummy",
          url: "https://checkout.stripe.com/dummy",
        }),
        list: stripeSessionList,
        expire: stripeSessionExpire,
        retrieve: async (id: string) => ({ id, status: "open" }),
      },
    },
  }),
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
  // The guest checkout builder's constants (#224 cases) — the real values.
  CHECKOUT_CLAIM_COOKIE: "checkout_claim",
  GUEST_METADATA_KEYS: {
    guest: "guest",
    claimToken: "claim_token",
    trialToken: "trial_token",
  },
}));

// The Clerk webhook's signature check is exercised in its own suite
// (app/api/webhooks/clerk/route.test.ts); here the event is handed over
// verified so the audit sees only what the handler itself logs.
vi.mock("@clerk/nextjs/webhooks", () => ({ verifyWebhook: clerkVerify }));
// The app's progress route resolves the caller through Clerk; a fixed user
// keeps the audit on the path that actually reaches the database.
// The guest checkout cases (#224) need an ANONYMOUS caller — a signed-in one
// is bounced to the auth flow before anything is logged.
// The app's «Delete account» (#309) deletes the account at Clerk after the
// erasure — a spy, so its refusal can be seeded with a marker.
// The users mirror (#380) asks Clerk about the row holding a new account's
// address — a spy, so its answers and refusals can carry a marker.
const accountAudit = vi.hoisted(() => ({
  clerkDelete: vi.fn(),
  clerkGetUser: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: walletAudit.authUserId }),
  clerkClient: async () => ({
    users: {
      deleteUser: accountAudit.clerkDelete,
      getUser: accountAudit.clerkGetUser,
    },
  }),
}));
// The guest action's per-IP brake is not the thing under audit; inert. The
// signed-in builders' per-account brake (#227) is a spy: one case flips it to
// watch the line the refusal logs.
vi.mock("@/lib/checkout-rate-limit", () => ({
  guestCheckoutRateLimited: async () => false,
  checkoutRateLimited: walletAudit.rateLimited,
  AUTH_CHECKOUT_RATELIMIT_PER_HOUR: 10,
}));

// The reminder dispatch path pulls in auth, Next's cache and the Resend SDK —
// none of which is the thing under audit. Everything except the action's own
// logging is stubbed to inert values.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => ({ id: "admin_1" }),
  // The checkout builder's signed-in user — the address it carries is exactly
  // what the audit case must keep out of the log.
  getOrSyncCurrentUser: async () => ({
    id: "user_1",
    email: MARKER_EMAIL,
    stripeCustomerId: "cus_dummy",
  }),
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
  // The playback-token routes (#305) sign on every success; the JWT is not
  // under audit.
  signMuxPlaybackToken: () => "dummy-playback-jwt",
}));

// The playback-token routes' best-effort funnel writes (#305): the trial
// helpers are spies so a case can make them fail the way the driver does —
// with the statement and its params, the anonymous identity among them. They
// DELEGATE to the real functions by default, so nothing else in this file
// sees a difference. `trialCookie` is the web viewer's trial_session cookie.
const tokenAudit = vi.hoisted(() => {
  const real: Record<string, (...args: unknown[]) => unknown> = {};
  return {
    real,
    find: vi.fn((...args: unknown[]) => real.findTrialSession(...args)),
    mint: vi.fn((...args: unknown[]) => real.mintTrialSession(...args)),
    stamp: vi.fn((...args: unknown[]) => real.stampSignupWall(...args)),
    trialCookie: "",
  };
});
vi.mock("@/lib/trial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trial")>();
  tokenAudit.real.findTrialSession = actual.findTrialSession as (...args: unknown[]) => unknown;
  tokenAudit.real.mintTrialSession = actual.mintTrialSession as (...args: unknown[]) => unknown;
  tokenAudit.real.stampSignupWall = actual.stampSignupWall as (...args: unknown[]) => unknown;
  return {
    ...actual,
    findTrialSession: tokenAudit.find,
    mintTrialSession: tokenAudit.mint,
    stampSignupWall: tokenAudit.stamp,
  };
});

// The paywall wallet's confirm-time reporting (#214): the CAPI identity
// capture, the Meta call and PostHog are the vendor steps that can fail with a
// message quoting what was sent. Partial mocks — everything else in these
// modules (the #165 scrub keys the mirror case relies on) stays real.
// The spies DELEGATE to the real functions by default: every other case in
// this file (the Stripe mirror, the #165 scrub) must keep running the real
// Meta/PostHog code it always exercised. Only the wallet cases override them,
// one call at a time.
const walletAudit = vi.hoisted(() => {
  const real: Record<string, (...args: unknown[]) => unknown> = {};
  return {
    real,
    capiRead: vi.fn((...args: unknown[]) => real.readCapiIdentity(...args)),
    capiSend: vi.fn((...args: unknown[]) => real.sendCapiEvents(...args)),
    posthogCapture: vi.fn((...args: unknown[]) =>
      real.captureServerEvent(...args),
    ),
    consent: "",
    // The per-account checkout brake (#227) — allows unless a case says so.
    rateLimited: vi.fn(async () => false),
    // Who Clerk says is calling (every case but the guest ones: a user).
    authUserId: "user_1" as string | null,
    // The guest buyer's checkout_claim cookie (#224 cases) — a value the
    // audit can look for in the log, because it must never be there.
    claimCookie: "",
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "Mozilla/5.0 Safari" }),
  cookies: async () => ({
    // The guest builder (re)writes the claim cookie; the write is not under
    // audit.
    set: () => undefined,
    get: (name: string) => {
      if (name === "checkout_claim" && walletAudit.claimCookie) {
        return { value: walletAudit.claimCookie };
      }
      if (name === "cookie_consent" && walletAudit.consent) {
        return { value: walletAudit.consent };
      }
      if (name === "trial_session" && tokenAudit.trialCookie) {
        return { value: tokenAudit.trialCookie };
      }
      return undefined;
    },
  }),
}));
vi.mock("@/lib/capi-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/capi-identity")>();
  walletAudit.real.readCapiIdentity = actual.readCapiIdentity as (...args: unknown[]) => unknown;
  return { ...actual, readCapiIdentity: walletAudit.capiRead };
});
vi.mock("@/lib/meta-capi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meta-capi")>();
  walletAudit.real.sendCapiEvents = actual.sendCapiEvents as (...args: unknown[]) => unknown;
  return { ...actual, sendCapiEvents: walletAudit.capiSend };
});
vi.mock("@/lib/posthog-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/posthog-server")>();
  walletAudit.real.captureServerEvent = actual.captureServerEvent as (...args: unknown[]) => unknown;
  return { ...actual, captureServerEvent: walletAudit.posthogCapture };
});

// No watch-flow target for the builder case: the audit is about the log line,
// not about resolving a show from the database.
vi.mock("@/lib/checkout-target", () => ({
  resolveCheckoutTarget: async () => ({
    showSlug: null,
    episodeId: null,
    resume: null,
  }),
  buildWatchPath: () => null,
}));

import { sendShowReminders } from "@/app/admin/reminder-actions";
import { GET as retentionCron } from "@/app/api/cron/retention/route";
import { GET as readyz } from "@/app/api/readyz/route";
import { POST as clerkWebhook } from "@/app/api/webhooks/clerk/route";
import { POST as deleteAccount } from "@/app/api/v1/account/delete/route";
import { POST as saveProgress } from "@/app/api/v1/progress/route";
import { POST as saveSegments } from "@/app/api/v1/watch-segments/route";
import { POST as appPlaybackToken } from "@/app/api/v1/playback-token/route";
import { GET as webPlaybackToken } from "@/app/api/playback-token/route";
import {
  eraseUser,
  previewErasure,
  summarizeErasePreview,
  summarizeEraseResult,
} from "@/lib/erase-user";
import { mirrorSubscription } from "@/lib/subscription-mirror";
import { assembleUserExport, summarizeExport } from "@/lib/user-export";
import {
  createAuthCheckoutSession,
  reportWalletCheckoutStarted,
} from "@/app/subscribe/actions";
import { createGuestCheckoutSession } from "@/app/subscribe/guest-actions";
import { CheckoutRateLimitedError } from "@/lib/checkout-session";
import { CONSENT_VERSION, serializeConsent } from "@/lib/cookie-consent";
import { submitIdea } from "@/app/(public)/ideas/actions";
import type { IdeaSubmissionInput } from "@/lib/idea-submission";

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
  stripeSearch.mockReset().mockResolvedValue({ data: [], has_more: false });
  stripeSessionList.mockReset().mockResolvedValue({ data: [] });
  stripeSessionExpire.mockReset().mockResolvedValue({ id: "cs_test_dummy" });
  erasedCustomer.mockReset().mockResolvedValue(false);
  sentryMessage.mockReset();
  walletAudit.authUserId = "user_1";
  walletAudit.claimCookie = "";
  // mockReset puts back the delegating implementation each spy was built with.
  tokenAudit.find.mockReset();
  tokenAudit.mint.mockReset();
  tokenAudit.stamp.mockReset();
  tokenAudit.trialCookie = "";
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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
      // @sentry/nextjs 11 (#390) records the request on the spans too, as
      // OpenTelemetry attributes: one per header, the body, the client's IP.
      contexts: {
        trace: {
          data: {
            "url.query": `email=${MARKER_EMAIL}`,
            "http.request.header.cookie": [`__session=${MARKER_SECRET}`],
            "http.request.header.authorization": [`Bearer ${MARKER_SECRET}`],
            "http.request.body.data": JSON.stringify({ name: MARKER_NAME }),
          },
        },
      },
      spans: [
        { data: { "http.request.header.x-matio-device-id": [MARKER_SECRET] } },
      ],
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

  // #326: an error a route does not catch reaches Sentry through
  // `onRequestError`, and a DrizzleQueryError's message is the statement AND
  // its params (`Failed query: <sql>\nparams: <params>` — drizzle-orm
  // errors.js), which is where the trial cookie / device id and the IP hash
  // of a failed trial_sessions write sit. The class is irrelevant: the text is
  // cut wherever it travels.
  const SQL = 'select "id" from "trial_sessions" where "session_token" = $1';
  const DRIZZLE_TEXT = `Failed query: ${SQL}\nparams: ${MARKER_IDENTITY},show_1,${MARKER_IP_HASH}`;
  const QUOTED = [MARKER_IDENTITY, MARKER_IP_HASH];

  function drizzleEvent(): SentryEventLike {
    return {
      message: DRIZZLE_TEXT,
      logentry: { message: DRIZZLE_TEXT },
      breadcrumbs: [{ category: "sentry.event", message: DRIZZLE_TEXT }],
      exception: {
        values: [
          { type: "PostgresError", value: "terminating connection due to administrator command" },
          { type: "DrizzleQueryError", value: DRIZZLE_TEXT },
        ],
      },
    };
  }

  it("carries the quoted params before scrubbing", () => {
    const raw = JSON.stringify(drizzleEvent());

    for (const marker of QUOTED) expect(raw).toContain(marker);
  });

  it("cuts a failed query's params from the exception, the message and the breadcrumbs — through beforeSend", () => {
    const event = sentryPrivacyOptions().beforeSend(drizzleEvent());
    const scrubbed = JSON.stringify(event);

    for (const marker of QUOTED) expect(scrubbed).not.toContain(marker);
    // What an incident is fixed from stays: the class and the statement.
    expect(event?.exception?.values?.[1]).toEqual({
      type: "DrizzleQueryError",
      value: `Failed query: ${SQL}`,
    });
    expect(event?.message).toBe(`Failed query: ${SQL}`);
  });

  it("cuts them through beforeSendTransaction and beforeBreadcrumb too", () => {
    const options = sentryPrivacyOptions();
    const transaction = JSON.stringify(options.beforeSendTransaction(drizzleEvent()));
    const crumb = JSON.stringify(
      options.beforeBreadcrumb({ category: "sentry.event", message: DRIZZLE_TEXT }),
    );

    for (const marker of QUOTED) {
      expect(transaction).not.toContain(marker);
      expect(crumb).not.toContain(marker);
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

  beforeEach(() => {
    // PostHog stays off unless a case turns it on — with credentials in the
    // shell the erasure would otherwise reach the real persons endpoint.
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
  });

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

  // The customer search (#223) is the one Stripe call whose REQUEST is the
  // address (`email:'…'` in the query): a refusal echoes the query, and a
  // found customer object carries the address and the name.
  it("does not echo the address when the customer search fails — Stripe quotes the query, and the query is the address", async () => {
    stripeSearch.mockRejectedValue(
      Object.assign(
        new Error(`Invalid search query: email:'${MARKER_EMAIL}'`),
        { name: "StripeInvalidRequestError", code: "parameter_invalid", statusCode: 400 },
      ),
    );
    const req = deletedWithLiveSubscription();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(stripeSearch).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain(MARKER_EMAIL);
    // What it DOES say: the subject, the class, the code — and the hand path.
    expect(logged()).toContain("Stripe customer search FAILED");
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain("StripeInvalidRequestError");
    expect(logged()).toContain("parameter_invalid");
    const sentry = sentryMessage.mock.calls.map(render).join("\n");
    expect(sentry).not.toContain(MARKER_EMAIL);
    expect(sentry).toContain('"stripeSearch":"failed"');
  });

  it("names the customers the search found by id only — the customer objects carry the address and the name", async () => {
    stripeSearch.mockResolvedValue({
      data: [
        { id: "cus_older", email: MARKER_EMAIL, name: MARKER_NAME },
        { id: "cus_dummy", email: MARKER_EMAIL, name: MARKER_NAME },
      ],
      has_more: true,
    });
    const req = deletedWithLiveSubscription();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(logged()).not.toContain(MARKER_NAME);
    expect(logged()).toContain('"stripeCustomersTombstoned":["cus_dummy","cus_older"]');
    // The has_more warning is by id too.
    expect(logged()).toContain("more than 100 Stripe customers");
    expect(logged()).toContain(USER_ID);
  });

  // PostHog (#180): the person carries the address as a property, and a
  // refusal body quotes the request — the request being that person.
  // Seeded into BOTH answers; only ids and statuses may come out, to the
  // log and to Sentry alike.
  function posthogRefusing() {
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "phx_dummy");
    vi.stubEnv("POSTHOG_PROJECT_ID", "190233");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              { id: 42, name: MARKER_NAME, properties: { email: MARKER_EMAIL } },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "validation_error",
            detail: `Person ${MARKER_NAME} <${MARKER_EMAIL}> cannot be deleted`,
          }),
          { status: 400 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("does not echo PostHog's person or its error body when the person delete fails", async () => {
    const fetchMock = posthogRefusing();
    const req = deletedWithLiveSubscription();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(logged()).not.toContain(MARKER_NAME);
    // What it DOES say: the subject, the person id, the status that decided it.
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain('"personIds":["42"]');
    expect(logged()).toContain('"httpStatus":400');
    const sentry = sentryMessage.mock.calls.map(render).join("\n");
    expect(sentry).not.toContain(MARKER_EMAIL);
    expect(sentry).not.toContain(MARKER_NAME);
    expect(sentry).toContain("posthogStatus");
  });

  it("the script's apply summary (pnpm erase-user --apply) carries counts and statuses only", async () => {
    posthogRefusing();
    deletedWithLiveSubscription();
    const { db } = await import("@/db");
    const { getStripe } = await import("@/lib/stripe");
    const logged = captureConsole();

    const result = await eraseUser(USER_ID, {
      db,
      getStripe,
      posthog: { key: "phx_dummy", projectId: "190233" },
    });
    const summary = summarizeEraseResult(USER_ID, result);

    expect(summary).not.toContain(MARKER_EMAIL);
    expect(summary).not.toContain(MARKER_NAME);
    expect(summary).toContain(`subject: ${USER_ID}`);
    expect(summary).toContain("posthog: failed persons=1 http=400");
    expect(logged()).not.toContain(MARKER_EMAIL);
  });

  // Story ideas (#297) go by the account's address in the same erasure. The
  // deleted rows are seeded with the fan's own words: only a COUNT may come
  // out — of the info line, the apply summary and the dry run alike.
  function ideasDeleteSeeded() {
    del.mockImplementation((table: PgTable) =>
      getTableName(table) === "idea_submissions"
        ? deleteChain([
            {
              id: "idea_marker",
              authorName: MARKER_NAME,
              email: MARKER_EMAIL,
              story: MARKER_STORY,
            },
          ])
        : deleteChain([{ id: "rem_1" }]),
    );
  }

  it("erases the story ideas sent from the address (#297) and logs how many — never who wrote them or what", async () => {
    const req = deletedWithLiveSubscription();
    ideasDeleteSeeded();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(del.mock.calls.map(([table]) => getTableName(table as PgTable))).toEqual([
      "show_reminders",
      "idea_submissions",
      "users",
    ]);
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_STORY]) {
      expect(logged()).not.toContain(marker);
    }
    // What it DOES say: the count, on the erasure's info line.
    expect(logged()).toContain("erase user: local data erased");
    expect(logged()).toContain('"ideaSubmissionRows":1');
    const sentry = sentryMessage.mock.calls.map(render).join("\n");
    expect(sentry).not.toContain(MARKER_STORY);
    expect(sentry).not.toContain(MARKER_NAME);
  });

  it("the script's apply summary and dry run count the story ideas (#297) — idea_submissions=N, nothing else", async () => {
    deletedWithLiveSubscription();
    ideasDeleteSeeded();
    const { db } = await import("@/db");
    const { getStripe } = await import("@/lib/stripe");
    const logged = captureConsole();

    const result = await eraseUser(USER_ID, { db, getStripe, posthog: null });
    const applied = summarizeEraseResult(USER_ID, result);

    // The dry run reads counts; the count row is seeded with the markers
    // too, so a summary that copied a row instead of `n` would show them.
    select.mockReset().mockImplementation(() => {
      let table = "";
      const chain = {
        from: (t: PgTable) => {
          table = getTableName(t);
          return chain;
        },
        where: () => chain,
        limit: async () =>
          table === "users" ? [{ email: MARKER_EMAIL, stripeCustomerId: null }] : [],
        then: (
          resolve: (rows: unknown[]) => unknown,
          reject?: (err: unknown) => unknown,
        ) =>
          Promise.resolve(
            table === "idea_submissions"
              ? [{ n: 1, authorName: MARKER_NAME, email: MARKER_EMAIL, story: MARKER_STORY }]
              : [{ n: 0 }],
          ).then(resolve, reject),
      };
      return chain;
    });
    const preview = await previewErasure(USER_ID, { db, getStripe, posthog: null });
    const dryRun = summarizeErasePreview(USER_ID, preview);

    expect(applied).toContain("idea_submissions=1");
    expect(dryRun).toContain("idea_submissions=1");
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_STORY]) {
      expect(applied).not.toContain(marker);
      expect(dryRun).not.toContain(marker);
      expect(logged()).not.toContain(marker);
    }
  });

  it("the script's apply summary lists the customers tombstoned by id, never by the address they carry (#223)", async () => {
    stripeSearch.mockResolvedValue({
      data: [{ id: "cus_older", email: MARKER_EMAIL, name: MARKER_NAME }],
      has_more: false,
    });
    deletedWithLiveSubscription();
    const { db } = await import("@/db");
    const { getStripe } = await import("@/lib/stripe");
    const logged = captureConsole();

    const result = await eraseUser(USER_ID, { db, getStripe, posthog: null });
    const summary = summarizeEraseResult(USER_ID, result);

    expect(summary).not.toContain(MARKER_EMAIL);
    expect(summary).not.toContain(MARKER_NAME);
    expect(summary).toContain(
      "search=ok tombstoned customers=2 (ids cus_dummy, cus_older)",
    );
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(logged()).not.toContain(MARKER_NAME);
  });
});

describe("log audit · Clerk user.created × the address held by another row (#380)", () => {
  // The mirror write meets a row under another Clerk id holding the address
  // and asks Clerk about it. Four places the address could leak: the
  // driver's refusal (its message carries the params, its `detail` the key),
  // the stale row eraseUser reads, Clerk's answer (the account's current
  // address and name) and Clerk's refusal (it quotes what it is about).
  const NEW_ID = "user_new_marker";
  const STALE_ID = "user_stale_marker";
  const MOVED = "moved.leak.marker@example.invalid";

  beforeEach(() => {
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
    accountAudit.clerkGetUser.mockReset();
  });

  function selectChain(rows: unknown[]) {
    const chain = { from: () => chain, where: () => chain, limit: async () => rows };
    return chain;
  }

  /** The new account's user.created, the insert refused on the address. */
  function createdOnTakenAddress() {
    clerkVerify.mockResolvedValue({
      type: "user.created",
      object: "event",
      data: {
        id: NEW_ID,
        object: "user",
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: MARKER_EMAIL }],
      },
    });
    const refused = Object.assign(
      new Error(
        `Failed query: insert into "users" ("id", "email") values ($1, $2)\nparams: ${NEW_ID},${MARKER_EMAIL}`,
      ),
      {
        cause: Object.assign(
          new Error('duplicate key value violates unique constraint "users_email_unique"'),
          {
            code: "23505",
            constraint_name: "users_email_unique",
            detail: `Key (email)=(${MARKER_EMAIL}) already exists.`,
          },
        ),
      },
    );
    insert
      .mockImplementationOnce(() => ({
        values: () => ({
          onConflictDoNothing: async () => {
            throw refused;
          },
        }),
      }))
      .mockImplementation(() => ({
        values: () => ({ onConflictDoNothing: async () => undefined }),
      }));
    select
      // The holder of the address…
      .mockImplementationOnce(() => selectChain([{ id: STALE_ID }]))
      // …and, should it be erased, the row eraseUser reads (address and all,
      // a paid-once customer id), then no live subscription.
      .mockImplementationOnce(() =>
        selectChain([{ email: MARKER_EMAIL, stripeCustomerId: "cus_dummy" }]),
      )
      .mockImplementation(() => selectChain([]));
    update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }));
    del.mockImplementation(() => ({
      where: () =>
        Object.assign(Promise.resolve(undefined), { returning: async () => [] }),
    }));
    return new Request("https://matio.tv/api/webhooks/clerk", { method: "POST" }) as never;
  }

  function sentryCalls() {
    return sentryMessage.mock.calls.map(render).join("\n");
  }

  it("a stale row of a deleted Clerk account is erased by id — the address appears in no log line and no Sentry event", async () => {
    accountAudit.clerkGetUser.mockRejectedValue(
      Object.assign(new Error(`No user was found with email ${MARKER_EMAIL}`), {
        name: "ClerkAPIResponseError",
        status: 404,
      }),
    );
    const req = createdOnTakenAddress();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(sentryCalls()).not.toContain(MARKER_EMAIL);
    // What it DOES say: both ids and the outcome, and eraseUser's own line.
    expect(logged()).toContain(NEW_ID);
    expect(logged()).toContain(STALE_ID);
    expect(logged()).toContain('"outcome":"stale_row_erased"');
    expect(logged()).toContain("erase user: local data erased");
    expect(sentryCalls()).toContain(STALE_ID);
    // A late erasure: the address never goes to Stripe as a query; the row's
    // own customer is tombstoned and named by id.
    expect(stripeSearch).not.toHaveBeenCalled();
    expect(logged()).toContain('"stripeSearch":"skipped_address_reassigned"');
    expect(logged()).toContain('"stripeCustomersTombstoned":["cus_dummy"]');
  });

  it("a live account's stale address is corrected — neither address nor its name is logged", async () => {
    accountAudit.clerkGetUser.mockResolvedValue({
      firstName: MARKER_NAME,
      primaryEmailAddress: { emailAddress: MOVED },
      emailAddresses: [{ emailAddress: MOVED }],
    });
    const req = createdOnTakenAddress();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    for (const marker of [MARKER_EMAIL, MOVED, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
      expect(sentryCalls()).not.toContain(marker);
    }
    expect(logged()).toContain('"outcome":"stale_address_corrected"');
  });

  it("an address still owned by a live account is reported by ids alone", async () => {
    accountAudit.clerkGetUser.mockResolvedValue({
      firstName: MARKER_NAME,
      primaryEmailAddress: { emailAddress: MARKER_EMAIL },
      emailAddresses: [{ emailAddress: MARKER_EMAIL }],
    });
    const req = createdOnTakenAddress();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(200);
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
      expect(sentryCalls()).not.toContain(marker);
    }
    expect(logged()).toContain('"outcome":"address_still_owned"');
    expect(sentryCalls()).toContain(NEW_ID);
  });

  it("Clerk's refusal is logged by status and class — never the text that quotes the address", async () => {
    accountAudit.clerkGetUser.mockRejectedValue(
      Object.assign(new Error(`Upstream failure looking up ${MARKER_EMAIL}`), {
        name: "ClerkAPIResponseError",
        status: 503,
      }),
    );
    const req = createdOnTakenAddress();
    const logged = captureConsole();

    const res = await clerkWebhook(req);

    expect(res.status).toBe(500);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(sentryCalls()).not.toContain(MARKER_EMAIL);
    expect(logged()).toContain('"httpStatus":503');
    expect(logged()).toContain("ClerkAPIResponseError");
  });
});

describe("log audit · /api/v1/account/delete (the app's self-service erasure, #309)", () => {
  // The same erasure as the webhook above, run inline from the app, plus the
  // Clerk half. Three places the address could leak: the users row eraseUser
  // reads, a driver refusal that quotes the statement, and Clerk's refusal —
  // its errors quote the identifier they are about.
  const USER_ID = "user_1"; // who the audit's auth() says is calling

  beforeEach(() => {
    vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
    vi.stubEnv("POSTHOG_PROJECT_ID", "");
    accountAudit.clerkDelete.mockReset().mockResolvedValue({ id: USER_ID });
  });

  function selectChain(rows: unknown[]) {
    const chain = { from: () => chain, where: () => chain, limit: async () => rows };
    return chain;
  }

  function accountWithLiveSubscription() {
    select
      .mockImplementationOnce(() =>
        selectChain([{ email: MARKER_EMAIL, stripeCustomerId: "cus_dummy" }]),
      )
      .mockImplementationOnce(() => selectChain([{ stripeSubscriptionId: "sub_dummy" }]))
      // The sweep after Clerk's delete: nothing came back.
      .mockImplementationOnce(() => selectChain([]));
    insert.mockImplementation(() => ({
      values: () => ({ onConflictDoNothing: async () => undefined }),
    }));
    del.mockImplementation(() => ({
      where: () =>
        Object.assign(Promise.resolve(undefined), {
          returning: async () => [{ id: "rem_1" }],
        }),
    }));
  }

  function request() {
    return new Request("https://matio.tv/api/v1/account/delete", {
      method: "POST",
      headers: { authorization: "Bearer sess_dummy" },
    }) as never;
  }

  it("erases and deletes an account with a live subscription without logging its address", async () => {
    accountWithLiveSubscription();
    const logged = captureConsole();

    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    expect(accountAudit.clerkDelete).toHaveBeenCalledWith(USER_ID);
    expect(logged()).not.toContain(MARKER_EMAIL);
    // What it DOES log: the subject and the outcome of each half.
    expect(logged()).toContain("account delete: done");
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain('"clerk":"deleted"');
    expect(logged()).toContain('"sweep":"clean"');
  });

  it("a database refusal mid-erasure is logged and answered by class — never the statement the driver quoted", async () => {
    vi.stubEnv("DATABASE_URL", MARKER_DATABASE_URL);
    accountWithLiveSubscription();
    del.mockImplementation(() => ({
      where: () => {
        throw Object.assign(
          new Error(
            `delete from show_reminders where email = '${MARKER_EMAIL}' (${MARKER_NAME}) — ${MARKER_DATABASE_URL}`,
          ),
          { name: "PostgresError", code: "57P01" },
        );
      },
    }));
    const logged = captureConsole();

    const res = await deleteAccount(request());

    expect(res.status).toBe(500);
    expect(accountAudit.clerkDelete).not.toHaveBeenCalled();
    const body = JSON.stringify(await res.json());
    const sentry = sentryMessage.mock.calls.map(render).join("\n");
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_SECRET, "db.example.invalid"]) {
      expect(logged()).not.toContain(marker);
      expect(body).not.toContain(marker);
      expect(sentry).not.toContain(marker);
    }
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain("PostgresError");
    expect(logged()).toContain("57P01");
  });

  it("a failed sweep after Clerk's delete is logged by class — never the row the driver quoted", async () => {
    accountWithLiveSubscription();
    select.mockReset();
    select
      .mockImplementationOnce(() =>
        selectChain([{ email: MARKER_EMAIL, stripeCustomerId: "cus_dummy" }]),
      )
      .mockImplementationOnce(() => selectChain([{ stripeSubscriptionId: "sub_dummy" }]))
      .mockImplementationOnce(() => {
        throw Object.assign(
          new Error(`select from users where email = '${MARKER_EMAIL}' (${MARKER_NAME})`),
          { name: "PostgresError", code: "08006" },
        );
      });
    const logged = captureConsole();

    const res = await deleteAccount(request());

    expect(res.status).toBe(200);
    const sentry = sentryMessage.mock.calls.map(render).join("\n");
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
      expect(sentry).not.toContain(marker);
    }
    expect(logged()).toContain("sweep for a healed users row FAILED");
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain("08006");
    expect(sentry).toContain('"step":"sweep"');
  });

  it("Clerk's refusal is logged by status and class — never the identifier its error quotes", async () => {
    accountWithLiveSubscription();
    accountAudit.clerkDelete.mockRejectedValue(
      Object.assign(new Error(`Unprocessable Entity: ${MARKER_EMAIL}`), {
        name: "ClerkAPIResponseError",
        status: 422,
        errors: [
          {
            code: "form_identifier_invalid",
            message: `${MARKER_EMAIL} is invalid`,
            longMessage: `${MARKER_NAME} <${MARKER_EMAIL}> cannot be deleted right now`,
          },
        ],
      }),
    );
    const logged = captureConsole();

    const res = await deleteAccount(request());

    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    const sentry = sentryMessage.mock.calls.map(render).join("\n");
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
      expect(body).not.toContain(marker);
      expect(sentry).not.toContain(marker);
    }
    expect(logged()).toContain("Clerk account could NOT be deleted");
    expect(logged()).toContain(USER_ID);
    expect(logged()).toContain('"httpStatus":422');
    expect(logged()).toContain("ClerkAPIResponseError");
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

  it("logs a users-row heal that did not take by ids only — never the synced address or the quoted row (#303)", async () => {
    // A foreign-key failure sends the save through getOrSyncCurrentUser
    // (mocked above: a user carrying MARKER_EMAIL) and one retry. Here the
    // retry fails the same way, so the route answers 503 and logs the one
    // line this path writes — the driver's echo and the synced user's
    // address both within reach of it.
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
      throw Object.assign(
        new Error(
          `insert into watch_progress (user_id) values ('${MARKER_NAME} <${MARKER_EMAIL}>') — ${MARKER_DATABASE_URL}`,
        ),
        { cause: Object.assign(new Error(`fk violation for ${MARKER_EMAIL}`), { code: "23503" }) },
      );
    });
    const logged = captureConsole();

    const res = await saveProgress(
      post({ episodeId: EPISODE, positionSeconds: 10, completed: false }),
    );

    expect(res.status).toBe(503);
    expect(logged()).toContain("users mirror not healed"); // the line was written
    expect(logged()).toContain("user_1");
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

describe("log audit · the playback-token routes' funnel writes (#305)", () => {
  // Both token routes (the app's POST /api/v1/playback-token and the web's
  // GET /api/playback-token) mint a trial_sessions row on a free episode and
  // stamp the sign-up wall on it on a member episode — STRICTLY best-effort:
  // a failure is swallowed and warned about, playback goes on. The realistic
  // worst case is a driver error: Drizzle's wrapper repeats the statement
  // with its params — the anonymous identity (the app's device UUID, the
  // web's trial cookie) and the HMAC of the viewer's IP. Only the show and
  // episode ids may come out.
  const EPISODE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const SHOW = "show_1";
  const MARKERS = [MARKER_IDENTITY, MARKER_IP_HASH, MARKER_SECRET, "db.example.invalid"];

  function driverError(statement: string) {
    // Drizzle's own layout: the statement, a newline, then `params: <list>`.
    const text = `${statement}\nparams: ${MARKER_IDENTITY},${SHOW},${MARKER_IP_HASH} — ${MARKER_DATABASE_URL}`;
    const cause = Object.assign(new Error(text), { name: "PostgresError", code: "57P01" });
    return Object.assign(new Error(`Failed query: ${text}`), {
      name: "DrizzleQueryError",
      cause,
    });
  }
  const MINT = 'insert into "trial_sessions" ("session_token", "show_id", "ip_hash") values ($1, $2, $3)';
  const STAMP = 'update "trial_sessions" set "signup_wall_at" = now() where "session_token" = $1 and "show_id" = $2';
  const FIND = 'select "expires_at" from "trial_sessions" where ("session_token" = $1 and "show_id" = $2)';

  /** The episode lookup both routes open with: a ready episode of a published show. */
  function episodeRow(access: "free" | "member") {
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: async () => [{ playbackId: "pb_dummy", showId: SHOW, access }],
    };
    select.mockImplementation(() => chain);
  }

  function appRequest(): Parameters<typeof appPlaybackToken>[0] {
    return {
      headers: new Headers({
        "x-matio-device-id": MARKER_IDENTITY,
        "x-vercel-forwarded-for": "203.0.113.9",
      }),
      json: async () => ({ episodeId: EPISODE }),
    } as unknown as Parameters<typeof appPlaybackToken>[0];
  }

  function webRequest(episodeId: string): Parameters<typeof webPlaybackToken>[0] {
    const url = new URL("https://matio.tv/api/playback-token");
    url.searchParams.set("episode_id", episodeId);
    return {
      nextUrl: url,
      cookies: { get: () => undefined },
      headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.9" }),
    } as unknown as Parameters<typeof webPlaybackToken>[0];
  }

  beforeEach(() => {
    // Paid mode — the episode's own tier decides, as in production today —
    // and an anonymous viewer, the only one these writes exist for.
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    walletAudit.authUserId = null;
    tokenAudit.trialCookie = MARKER_IDENTITY;
    tokenAudit.find.mockResolvedValue(null);
  });

  it("app, free episode: a failed trial mint is logged by show and episode id — never the device id, the IP hash or the database URL", async () => {
    episodeRow("free");
    tokenAudit.mint.mockRejectedValue(driverError(MINT));
    const logged = captureConsole();

    const res = await appPlaybackToken(appRequest());

    expect(res.status).toBe(200); // playback is never the price of a tracking failure
    // The fixture is honest: the device id really was in the failed write.
    expect(tokenAudit.mint).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: MARKER_IDENTITY }),
    );
    for (const marker of MARKERS) expect(logged()).not.toContain(marker);
    expect(logged()).toContain(
      `[v1/playback-token] free tracking skipped {"showId":"${SHOW}","episodeId":"${EPISODE}"}`,
    );
  });

  it("app, member episode: a failed sign-up-wall stamp is logged by show and episode id only", async () => {
    episodeRow("member");
    tokenAudit.stamp.mockRejectedValue(driverError(STAMP));
    const logged = captureConsole();

    const res = await appPlaybackToken(appRequest());

    expect(res.status).toBe(403);
    expect(tokenAudit.stamp).toHaveBeenCalledWith(MARKER_IDENTITY, SHOW);
    for (const marker of MARKERS) expect(logged()).not.toContain(marker);
    expect(logged()).toContain(
      `[v1/playback-token] signup-wall stamp skipped {"showId":"${SHOW}","episodeId":"${EPISODE}"}`,
    );
  });

  it("web, free episode: a failed trial mint is logged by show and episode id — never the trial cookie, the IP hash or the database URL", async () => {
    episodeRow("free");
    tokenAudit.mint.mockRejectedValue(driverError(MINT));
    const logged = captureConsole();

    const res = await webPlaybackToken(webRequest(EPISODE));

    expect(res.status).toBe(200);
    expect(tokenAudit.mint).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: MARKER_IDENTITY }),
    );
    for (const marker of MARKERS) expect(logged()).not.toContain(marker);
    expect(logged()).toContain(
      `[playback-token] free-tier tracking skipped {"showId":"${SHOW}","episodeId":"${EPISODE}"}`,
    );
  });

  it("web, member episode: a failed sign-up-wall stamp is logged by show and episode id only", async () => {
    episodeRow("member");
    tokenAudit.stamp.mockRejectedValue(driverError(STAMP));
    const logged = captureConsole();

    const res = await webPlaybackToken(webRequest(EPISODE));

    expect(res.status).toBe(403);
    expect(tokenAudit.stamp).toHaveBeenCalledWith(MARKER_IDENTITY, SHOW);
    for (const marker of MARKERS) expect(logged()).not.toContain(marker);
    expect(logged()).toContain(
      `[playback-token] signup-wall stamp skipped {"showId":"${SHOW}","episodeId":"${EPISODE}"}`,
    );
  });

  // #326 — the legacy 60-second preview (an all-subscriber show, paid mode).
  // Unlike the best-effort writes above, its trial_sessions read and write
  // are the access decision, so a failure there used to be thrown to the
  // framework — which prints an unhandled error's message, i.e. the statement
  // WITH its params, to the runtime log. Both routes now catch it at the
  // boundary, answer 503 and report the class and SQLSTATE only.
  function legacyPreviewRows() {
    // The episode lookup, then showHasTierGating's probe: no free / member
    // episode on the show, so the request falls through to the 60s preview.
    const answers: unknown[][] = [[{ playbackId: "pb_dummy", showId: SHOW, access: "subscriber" }], []];
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: async () => answers.shift() ?? [],
    };
    select.mockImplementation(() => chain);
  }

  const PREVIEW_ROUTES = [
    {
      name: "app",
      tag: "[v1/playback-token]",
      call: () => appPlaybackToken(appRequest()),
    },
    {
      name: "web",
      tag: "[playback-token]",
      call: () => webPlaybackToken(webRequest(EPISODE)),
    },
  ] as const;

  it.each(PREVIEW_ROUTES)(
    "$name, legacy preview: a failed trial lookup answers 503 and logs the class and SQLSTATE — never the identity, the IP hash or the database URL",
    async ({ tag, call }) => {
      legacyPreviewRows();
      tokenAudit.find.mockRejectedValue(driverError(FIND));
      const logged = captureConsole();

      const res = await call();
      const body = JSON.stringify(await res.json());

      expect(res.status).toBe(503);
      // The fixture is honest: the identity really was in the failed read.
      expect(tokenAudit.find).toHaveBeenCalledWith(MARKER_IDENTITY, SHOW);
      expect(logged()).toContain(`${tag} trial store failed {"name":"DrizzleQueryError","code":"57P01"}`);
      for (const marker of MARKERS) {
        expect(logged()).not.toContain(marker);
        expect(body).not.toContain(marker);
        expect(JSON.stringify(sentryMessage.mock.calls)).not.toContain(marker);
      }
      expect(sentryMessage).toHaveBeenCalledTimes(1);
    },
  );

  it.each(PREVIEW_ROUTES)(
    "$name, legacy preview: a failed trial mint answers 503 and logs the class and SQLSTATE only",
    async ({ tag, call }) => {
      legacyPreviewRows();
      tokenAudit.mint.mockRejectedValue(driverError(MINT));
      const logged = captureConsole();

      const res = await call();
      const body = JSON.stringify(await res.json());

      expect(res.status).toBe(503);
      expect(tokenAudit.mint).toHaveBeenCalledWith(
        expect.objectContaining({ sessionToken: MARKER_IDENTITY }),
      );
      expect(logged()).toContain(`${tag} trial store failed {"name":"DrizzleQueryError","code":"57P01"}`);
      for (const marker of MARKERS) {
        expect(logged()).not.toContain(marker);
        expect(body).not.toContain(marker);
        expect(JSON.stringify(sentryMessage.mock.calls)).not.toContain(marker);
      }
      expect(sentryMessage).toHaveBeenCalledTimes(1);
    },
  );

  it("web: an episode_id that is not an id is refused before the query — Postgres would quote it back, and the framework logs that", async () => {
    // What the driver does with text bound for a uuid column: refuse it,
    // quoting the value. The route would throw it to the framework's logger.
    const typed = `${MARKER_NAME} <${MARKER_EMAIL}>`;
    select.mockImplementation(() => {
      throw Object.assign(new Error(`invalid input syntax for type uuid: "${typed}"`), {
        name: "PostgresError",
        code: "22P02",
      });
    });
    const logged = captureConsole();

    const res = await webPlaybackToken(webRequest(typed));
    const body = JSON.stringify(await res.json());

    expect(res.status).toBe(400);
    expect(select).not.toHaveBeenCalled();
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
      expect(body).not.toContain(marker);
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
      // A story idea (#297): the author, the address and the story itself.
      idea_submissions: [
        {
          id: "idea_marker",
          kind: "new_series",
          authorName: MARKER_NAME,
          email: MARKER_EMAIL,
          logline: "What if a banished postman had one last letter to deliver?",
          story: MARKER_STORY,
        },
      ],
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

  it("counts the story ideas (#297) in the summary — idea_submissions=1, never the author, the address or the story", async () => {
    const result = await assembleUserExport({
      userId: USER_ID,
      rows: seededRows(),
      clients: {},
    });
    // The file carries the idea — it is the person's data by definition.
    const document = JSON.stringify(result.database.idea_submissions);
    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_STORY]) {
      expect(document).toContain(marker);
    }

    const summary = summarizeExport(result);

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_STORY, "postman"]) {
      expect(summary).not.toContain(marker);
    }
    expect(summary).toContain("idea_submissions=1");
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

describe("log audit · wallet checkout-intent reporting (#214)", () => {
  // The paywall wallet reports InitiateCheckout / checkout_started when the
  // buyer confirms. Every vendor step on that path can fail with a message that
  // quotes what was sent, and the users row it reads holds the address. Only
  // step names, error classes, codes and statuses may come out.
  const quoted = (name: string) =>
    Object.assign(new Error(`rejected ${MARKER_NAME} <${MARKER_EMAIL}>`), {
      name,
      code: "marker_code",
      statusCode: 400,
    });

  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("WALLET_EXPRESS_CHECKOUT", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
    walletAudit.consent = serializeConsent({
      necessary: true,
      marketing: true,
      ts: 0,
      v: CONSENT_VERSION,
    });
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: async () => [{ email: MARKER_EMAIL }],
    };
    select.mockImplementation(() => chain);
  });

  it("logs failed vendor calls by step and class — never the buyer's address", async () => {
    walletAudit.capiRead.mockRejectedValueOnce(quoted("CapiIdentityError"));
    walletAudit.capiSend.mockRejectedValueOnce(quoted("FetchError"));
    walletAudit.posthogCapture.mockRejectedValueOnce(quoted("PostHogError"));
    const logged = captureConsole();

    await reportWalletCheckoutStarted("cs_test_marker");

    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
    }
    // What it DOES log: which step failed, and the vendor's class and code.
    expect(logged()).toContain("walletCheckout: CAPI identity capture failed");
    expect(logged()).toContain("startCheckout: CAPI InitiateCheckout threw");
    expect(logged()).toContain("startCheckout: PostHog checkout_started threw");
    expect(logged()).toContain("marker_code");
  });

  it("logs a failure that escapes the vendor calls by class, not by message", async () => {
    // A synchronous throw skips the per-call catches and reaches the outer one.
    walletAudit.posthogCapture.mockImplementationOnce(() => {
      throw quoted("PostHogError");
    });
    const logged = captureConsole();

    await reportWalletCheckoutStarted("cs_test_marker");

    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).toContain("walletCheckout: checkout-intent reporting threw");
    expect(logged()).toContain("PostHogError");
  });
});

describe("log audit · checkout session builder (prepareAuthCheckout, #214)", () => {
  // The one checkout log line the wallet cases above cannot reach: the CAPI
  // identity capture inside the builder that /checkout and the wallet share.
  // The signed-in user it works with carries the address.
  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_dummy");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_dummy");
    walletAudit.consent = serializeConsent({
      necessary: true,
      marketing: true,
      ts: 0,
      v: CONSENT_VERSION,
    });
    // No existing access-granting row, so the builder proceeds past layer 1.
    const chain = { from: () => chain, where: () => chain, limit: async () => [] };
    select.mockImplementation(() => chain);
  });

  it("logs a failed CAPI identity capture by class — never the buyer's address", async () => {
    walletAudit.capiRead.mockRejectedValueOnce(
      Object.assign(new Error(`rejected ${MARKER_NAME} <${MARKER_EMAIL}>`), {
        name: "CapiIdentityError",
        code: "marker_code",
      }),
    );
    const logged = captureConsole();

    const res = await createAuthCheckoutSession({ show: null, ep: null, resume: null });

    expect(res.kind).toBe("embedded");
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).toContain("startCheckout: CAPI identity capture failed");
    expect(logged()).toContain("marker_code");
  });

  it("logs a refused (rate-limited) checkout by user id only — never the buyer's address (#227)", async () => {
    walletAudit.rateLimited.mockResolvedValueOnce(true);
    const logged = captureConsole();

    const err = await createAuthCheckoutSession({
      show: null,
      ep: null,
      resume: null,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CheckoutRateLimitedError);
    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
      // The /checkout dispatcher maps it to a rate_limited code (#233), so
      // it no longer reaches the client or Sentry as a rejection; it
      // carries no data either way.
      expect(render(err)).not.toContain(marker);
    }
    expect(logged()).toContain("startCheckout: rate limited");
    expect(logged()).toContain("user_1");
  });
});

describe("log audit · one-open-session sweep after a checkout create (#217)", () => {
  // Every create is followed by list + expire of the buyer's other open
  // sessions; when that cannot be completed the new session is closed and the
  // failure logged. Stripe's error text can quote what was sent — the
  // customer's e-mail among it — so only ids and the error class may come out.
  const quoted = (name: string) =>
    Object.assign(new Error(`rejected ${MARKER_NAME} <${MARKER_EMAIL}>`), {
      name,
      code: "marker_code",
      statusCode: 400,
    });

  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_dummy");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_dummy");
    walletAudit.consent = "";
    const chain = { from: () => chain, where: () => chain, limit: async () => [] };
    select.mockImplementation(() => chain);
  });

  it("logs a failed sweep — and a failed close of the new session — by ids and class, never the buyer's address", async () => {
    stripeSessionList.mockRejectedValueOnce(quoted("StripeConnectionError"));
    stripeSessionExpire.mockRejectedValueOnce(quoted("StripeAPIError"));
    const logged = captureConsole();

    await expect(
      createAuthCheckoutSession({ show: null, ep: null, resume: null }),
    ).rejects.toThrow();

    for (const marker of [MARKER_EMAIL, MARKER_NAME]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).toContain(
      "startCheckout: could not expire the customer's other open sessions",
    );
    expect(logged()).toContain("startCheckout: closing the new session failed too");
    expect(logged()).toContain("cs_test_dummy");
    expect(logged()).toContain("StripeConnectionError");
    expect(logged()).toContain("StripeAPIError");
    expect(logged()).toContain("marker_code");
  });
});

describe("log audit · guest checkout sweep (#224)", () => {
  // The pay-first guest's create is followed by the guest half of the sweep:
  // the session id is recorded under an HMAC of the claim cookie and the
  // buyer's PREVIOUS session is expired by id. Three things can fail and log
  // — the Stripe expire (its error text can quote the request), the DB
  // upsert (Drizzle's wrapper quotes the statement) and the best-effort
  // prune — and none of them may carry the claim cookie, its hash, or a
  // person. Only session ids and error classes come out.
  const MARKER_CLAIM = "11111111-2222-4333-8444-555555555555";
  const quoted = (name: string) =>
    Object.assign(
      new Error(`rejected ${MARKER_NAME} <${MARKER_EMAIL}> claim ${MARKER_CLAIM}`),
      { name, code: "marker_code", statusCode: 400 },
    );
  const claimAnswers = (previousSessionId: string | null) => ({
    values: () => ({
      onConflictDoUpdate: () => ({
        returning: async () => [{ previousSessionId }],
      }),
    }),
  });

  beforeEach(() => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("PAY_FIRST_CHECKOUT", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_dummy");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_dummy");
    walletAudit.consent = "";
    walletAudit.authUserId = null;
    walletAudit.claimCookie = MARKER_CLAIM;
    // No prune unless a case asks for one.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  it("logs a failed expire of the previous session — and a failed close of the new one — by session ids and class, never the claim cookie or the buyer", async () => {
    insert.mockImplementation(() => claimAnswers("cs_prev_dummy"));
    stripeSessionExpire
      .mockRejectedValueOnce(quoted("StripeAPIError"))
      .mockRejectedValueOnce(quoted("StripeConnectionError"));
    const logged = captureConsole();

    await expect(
      createGuestCheckoutSession({ show: null, ep: null, resume: null }),
    ).rejects.toThrow();

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_CLAIM]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).toContain(
      "startGuestCheckout: could not expire the buyer's previous open session",
    );
    expect(logged()).toContain("startGuestCheckout: closing the new session failed too");
    expect(logged()).toContain("cs_test_dummy");
    expect(logged()).toContain("cs_prev_dummy");
    expect(logged()).toContain("StripeAPIError");
    expect(logged()).toContain("StripeConnectionError");
    expect(logged()).toContain("marker_code");
  });

  it("logs the rollback of the claim after a failed expire by session ids only — the displaced-newer-session line and the rollback-failed line", async () => {
    // Two calls of the upsert per run: the claim (answers the previous id)
    // and, once the expire has failed, the rollback. First run (calls 1–2):
    // the rollback displaces a third tab's id. Second run (calls 3–4): the
    // rollback itself is refused.
    let call = 0;
    insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            call += 1;
            if (call === 1 || call === 3) return [{ previousSessionId: "cs_prev_dummy" }];
            if (call === 2) return [{ previousSessionId: "cs_third_dummy" }];
            throw Object.assign(
              new Error(`upsert refused ('${MARKER_CLAIM}-hash') ${MARKER_DATABASE_URL}`),
              { name: "PostgresError", code: "53300" },
            );
          },
        }),
      }),
    }));
    stripeSessionExpire.mockRejectedValue(quoted("StripeAPIError"));
    const logged = captureConsole();

    await expect(
      createGuestCheckoutSession({ show: null, ep: null, resume: null }),
    ).rejects.toThrow();
    await expect(
      createGuestCheckoutSession({ show: null, ep: null, resume: null }),
    ).rejects.toThrow();

    for (const marker of [MARKER_EMAIL, MARKER_NAME, MARKER_CLAIM, MARKER_SECRET, MARKER_DATABASE_URL]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).toContain(
      "startGuestCheckout: rolling back the claim displaced a newer session",
    );
    expect(logged()).toContain("cs_third_dummy");
    expect(logged()).toContain(
      "startGuestCheckout: rolling back the claim failed — the previous session stays unrecorded",
    );
    expect(logged()).toContain("cs_prev_dummy");
    expect(logged()).toContain("PostgresError");
  });

  it("logs a claim the database refused by class — never the statement or the hash the driver quoted", async () => {
    insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            throw Object.assign(
              new Error(
                `insert into "guest_checkout_sessions" … values ('${MARKER_CLAIM}-hash', …) ${MARKER_DATABASE_URL}`,
              ),
              { name: "PostgresError", code: "53300" },
            );
          },
        }),
      }),
    }));
    const logged = captureConsole();

    await expect(
      createGuestCheckoutSession({ show: null, ep: null, resume: null }),
    ).rejects.toThrow();

    for (const marker of [MARKER_CLAIM, MARKER_SECRET, MARKER_DATABASE_URL]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).not.toContain("guest_checkout_sessions");
    expect(logged()).toContain(
      "startGuestCheckout: could not expire the buyer's previous open session",
    );
    expect(logged()).toContain("PostgresError");
    expect(logged()).toContain("53300");
  });

  it("logs a failed prune by class only — and the sale goes through", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    insert.mockImplementation(() => claimAnswers(null));
    del.mockImplementation(() => ({
      where: async () => {
        throw Object.assign(
          new Error(`delete from "guest_checkout_sessions" … ${MARKER_DATABASE_URL}`),
          { name: "PostgresError", code: "40P01" },
        );
      },
    }));
    const logged = captureConsole();

    const res = await createGuestCheckoutSession({ show: null, ep: null, resume: null });

    expect(res.kind).toBe("embedded");
    for (const marker of [MARKER_CLAIM, MARKER_SECRET, MARKER_DATABASE_URL]) {
      expect(logged()).not.toContain(marker);
    }
    expect(logged()).not.toContain("guest_checkout_sessions");
    expect(logged()).toContain("claimSoleGuestSession: pruning stale rows failed");
    expect(logged()).toContain("PostgresError");
  });
});

describe("log audit · Clerk webhook signature failure", () => {
  it("rejects a bad signature without echoing the verifier's error text", async () => {
    clerkVerify.mockRejectedValue(
      Object.assign(new Error(`signature mismatch for ${MARKER_EMAIL}`), {
        name: "WebhookVerificationError",
      }),
    );
    const logged = captureConsole();

    const res = await clerkWebhook(
      new Request("https://matio.tv/api/webhooks/clerk", { method: "POST" }) as never,
    );

    expect(res.status).toBe(400);
    expect(logged()).not.toContain(MARKER_EMAIL);
    expect(logged()).toContain("WebhookVerificationError");
  });
});

describe("log audit · idea submission (/ideas, #297)", () => {
  // A fan's pitch is the freest text the site takes: a name, an address and
  // up to 10,000 characters of story, from an anonymous form. The action may
  // log a reason line or `{ name, code }` and nothing else — and it must
  // RESOLVE, because an unhandled throw would carry the driver's text to
  // Sentry through onRequestError. The worst cases seed the markers INTO the
  // thrown text, the way the driver quotes a statement's parameters.
  const MARKER_SERIES = "leak-marker-series";
  const MARKERS = [MARKER_NAME, MARKER_EMAIL, MARKER_STORY, MARKER_SERIES];

  function pitch(over: Partial<IdeaSubmissionInput> = {}): IdeaSubmissionInput {
    return {
      series: "new",
      workingTitle: "",
      logline: "What if a banished postman had one last letter to deliver?",
      story: MARKER_STORY,
      name: MARKER_NAME,
      email: MARKER_EMAIL,
      ageConfirmed: true,
      termsAccepted: true,
      marketingOptIn: true,
      website: "",
      ...over,
    };
  }

  /** Markers found in what would leave the process: the console, every Sentry call (tags included), the answer. */
  function leaked(logged: () => string, result: unknown): string[] {
    const outputs = [
      logged(),
      sentryMessage.mock.calls.map(render).join("\n"),
      render(result),
    ];
    return MARKERS.filter((marker) => outputs.some((out) => out.includes(marker)));
  }

  /** What Drizzle 0.44+ throws: its own wrapper quoting the query, the PostgresError on `.cause`. */
  function driverError(statement: string, code: string) {
    const cause = Object.assign(new Error(`${statement} — violates constraint`), {
      name: "PostgresError",
      code,
    });
    return Object.assign(new Error(`Failed query: ${statement}`), {
      name: "DrizzleQueryError",
      cause,
    });
  }

  /** The hourly brake's key per call — typed loosely: the spy is shared with the checkout cases. */
  const brakeKeys = () =>
    (walletAudit.rateLimited.mock.calls as unknown as [string, number][]).map(
      ([key]) => key,
    );

  beforeEach(() => {
    walletAudit.rateLimited.mockClear();
  });

  it("honeypot: a filled trap is swallowed with a success and one bare line — nothing written, the brake untouched", async () => {
    const logged = captureConsole();

    const result = await submitIdea(pitch({ website: "https://bot.example.invalid" }));

    expect(result).toEqual({ ok: true, onList: false });
    expect(logged()).toBe("submitIdea: honeypot");
    expect(leaked(logged, result)).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
    expect(walletAudit.rateLimited).not.toHaveBeenCalled();
  });

  it("a validation refusal answers field + code pairs only and logs nothing", async () => {
    const logged = captureConsole();

    const result = await submitIdea(
      pitch({
        story: MARKER_STORY.repeat(300),
        name: `${MARKER_NAME} `.repeat(20),
        ageConfirmed: false,
      }),
    );

    expect(result).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "story", code: "story_too_long" },
        { field: "name", code: "name_too_long" },
        { field: "age", code: "age_required" },
      ],
    });
    expect(logged()).toBe("");
    expect(leaked(logged, result)).toEqual([]);
    expect(walletAudit.rateLimited).not.toHaveBeenCalled();
  });

  it("a rate-limited submit answers a bare reason; the brake's key is `idea:` + a hash, never the address or an IP", async () => {
    walletAudit.rateLimited.mockResolvedValueOnce(true);
    const logged = captureConsole();

    const result = await submitIdea(pitch());

    expect(result).toEqual({ ok: false, reason: "rate_limited" });
    expect(insert).not.toHaveBeenCalled();
    const [key] = brakeKeys();
    expect(key).toMatch(/^idea:[0-9a-f]{64}$/);
    expect(leaked(logged, [result, key])).toEqual([]);
  });

  it("an insert failure whose driver error quotes the row resolves to server_error and reports class + SQLSTATE only", async () => {
    insert.mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            throw driverError(
              `insert into idea_submissions (author_name, email, story) values ('${MARKER_NAME}', '${MARKER_EMAIL}', '${MARKER_STORY}')`,
              "23514",
            );
          },
        }),
      }),
    }));
    const logged = captureConsole();

    const pending = submitIdea(pitch());

    await expect(pending).resolves.toEqual({ ok: false, reason: "server_error" });
    const result = await pending;
    expect(insert).toHaveBeenCalledTimes(1);
    expect(leaked(logged, result)).toEqual([]);
    // What it DOES say: the class of the thrown error and the SQLSTATE from
    // its `.cause` — the same pair in the log and in the Sentry tags.
    expect(logged()).toBe('submitIdea: failed {"name":"DrizzleQueryError","code":"23514"}');
    expect(sentryMessage).toHaveBeenCalledTimes(1);
    expect(sentryMessage.mock.calls[0]).toEqual([
      "submitIdea: failed",
      { level: "error", tags: { code: "23514", name: "DrizzleQueryError" } },
    ]);
  });

  it("a failed show lookup whose error quotes the client-sent series resolves to server_error, series and all kept out", async () => {
    select.mockImplementation(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: async () => {
          throw driverError(
            `select "id" from "shows" where ("shows"."slug" = '${MARKER_SERIES}' and "shows"."status" = 'published')`,
            "57014",
          );
        },
      };
      return chain;
    });
    const logged = captureConsole();

    const pending = submitIdea(pitch({ series: MARKER_SERIES }));

    await expect(pending).resolves.toEqual({ ok: false, reason: "server_error" });
    const result = await pending;
    expect(select).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(leaked(logged, result)).toEqual([]);
    expect(logged()).toBe('submitIdea: failed {"name":"DrizzleQueryError","code":"57014"}');
    expect(render(sentryMessage.mock.calls)).toContain('"code":"57014"');
  });
});
