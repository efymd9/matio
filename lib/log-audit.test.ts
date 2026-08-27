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

const { execute, select, update, batchSend } = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  batchSend: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { execute, select, update } }));

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
import { GET as readyz } from "@/app/api/readyz/route";

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
  batchSend.mockReset();
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
