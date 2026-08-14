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

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute } }));

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
