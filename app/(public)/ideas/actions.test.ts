import crypto from "node:crypto";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The /ideas submit action (#297). What is under test is what reaches the
// database and what leaves the process: exactly one row with exactly the
// columns the data map lists (no IP, no user id), the natural-key dedupe and
// the answer it gives, the order of the cheap refusals (honeypot and
// validation never touch the brake), and the never-throw contract — a
// failing query answers `server_error` and reports class + SQLSTATE only.
const h = vi.hoisted(() => ({
  headers: new Headers(),
  locale: "en" as "en" | "es",
  attribution: {
    first: { source: null, medium: null, campaign: null } as Record<string, string | null>,
    last: { source: null, medium: null, campaign: null } as Record<string, string | null>,
  },
  rateLimited: vi.fn<(key: string, limit: number) => Promise<boolean>>(async () => false),
  sentryMessage: vi.fn(),
  // What the fake database answers.
  showRows: [] as { id: string }[],
  showError: undefined as unknown,
  returned: [] as { marketingOptIn: boolean }[] | undefined,
  insertError: undefined as unknown,
  existing: [] as { marketingOptIn: boolean }[],
  // What it was asked.
  selects: [] as { table: string; fields: unknown; where: unknown; limit: number }[],
  inserts: [] as {
    table: string;
    values: Record<string, unknown>;
    conflict: { target: unknown[] };
    returning: unknown;
  }[],
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentryMessage }));
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }) }));
vi.mock("next/headers", () => ({
  headers: async () => h.headers,
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/checkout-rate-limit", () => ({ checkoutRateLimited: h.rateLimited }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => h.locale }));
vi.mock("@/lib/attribution", async (importOriginal) => {
  // The column mapping is the real one — only the cookie read is faked.
  const actual = await importOriginal<typeof import("@/lib/attribution")>();
  return { ...actual, readAttributionCookies: async () => h.attribution };
});
vi.mock("@/db", () => ({
  db: {
    select: (fields: unknown) => ({
      from: (table: PgTable) => ({
        where: (where: unknown) => ({
          limit: async (limit: number) => {
            const name = getTableName(table);
            h.selects.push({ table: name, fields, where, limit });
            if (name === "shows") {
              if (h.showError) throw h.showError;
              return h.showRows;
            }
            return h.existing;
          },
        }),
      }),
    }),
    insert: (table: PgTable) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: (conflict: { target: unknown[] }) => ({
          returning: async (returning: unknown) => {
            h.inserts.push({ table: getTableName(table), values, conflict, returning });
            if (h.insertError) throw h.insertError;
            return h.returned;
          },
        }),
      }),
    }),
  },
}));

import { ideaSubmissions } from "@/db/schema";
import {
  IDEA_RATELIMIT_PER_HOUR,
  IDEA_TERMS_VERSION,
  type IdeaSubmissionInput,
} from "@/lib/idea-submission";
import { hashClientIp } from "@/lib/trial";
import { submitIdea } from "./actions";

const SHOW_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const CLIENT_IP = "203.0.113.7";

function input(overrides: Partial<IdeaSubmissionInput> = {}): IdeaSubmissionInput {
  return {
    series: "the-scarlet-oath",
    workingTitle: "The Last Letter",
    logline: "What if a postman had one last letter to deliver?",
    story: "It begins at dawn.",
    name: "Ana",
    email: "Ana@Example.COM",
    ageConfirmed: true,
    termsAccepted: true,
    marketingOptIn: false,
    website: "",
    ...overrides,
  };
}

/** Render a WHERE the way the driver would see it: text + bound params. */
function render(where: unknown) {
  return new PgDialect().sqlToQuery(where as SQL);
}

/** What the driver throws through Drizzle 0.44+: the PostgresError sits on `.cause`. */
function driverError(code: string, message: string) {
  const cause = Object.assign(new Error(message), { name: "PostgresError", code });
  return Object.assign(new Error(`Failed query: ${message}`), {
    name: "DrizzleQueryError",
    cause,
  });
}

const consoleCalls = () =>
  [console.error, console.warn, console.info, console.log].flatMap(
    (fn) => (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls,
  );

beforeEach(() => {
  h.headers = new Headers({ "x-vercel-forwarded-for": CLIENT_IP });
  h.locale = "en";
  h.attribution = {
    first: { source: null, medium: null, campaign: null },
    last: { source: null, medium: null, campaign: null },
  };
  h.rateLimited.mockReset().mockResolvedValue(false);
  h.sentryMessage.mockReset();
  h.showRows = [{ id: SHOW_ID }];
  h.showError = undefined;
  h.returned = [{ marketingOptIn: false }];
  h.insertError = undefined;
  h.existing = [];
  h.selects = [];
  h.inserts = [];
  for (const level of ["error", "warn", "info", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitIdea — the happy path", () => {
  it("writes exactly one row with exactly the data map's columns", async () => {
    h.locale = "es";
    h.attribution = {
      first: { source: "fb", medium: "paid", campaign: "ideas_launch" },
      last: { source: "ig", medium: "social", campaign: "ideas_retarget" },
    };
    h.returned = [{ marketingOptIn: true }];

    const res = await submitIdea(input({ marketingOptIn: true }));

    expect(res).toEqual({ ok: true, onList: true });
    expect(h.inserts).toHaveLength(1);
    const { table, values } = h.inserts[0];
    expect(table).toBe("idea_submissions");
    expect(Object.keys(values).sort()).toEqual(
      [
        "attributionFirstCampaign",
        "attributionFirstMedium",
        "attributionFirstSource",
        "attributionLastCampaign",
        "attributionLastMedium",
        "attributionLastSource",
        "authorName",
        "contentHash",
        "email",
        "kind",
        "locale",
        "logline",
        "marketingOptIn",
        "showId",
        "story",
        "termsVersion",
        "workingTitle",
      ].sort(),
    );
    for (const forbidden of ["ip", "ipHash", "userId", "country"]) {
      expect(values).not.toHaveProperty(forbidden);
    }
    expect(values).toMatchObject({
      kind: "continuation",
      showId: SHOW_ID,
      workingTitle: "The Last Letter",
      authorName: "Ana",
      email: "ana@example.com",
      locale: "es",
      termsVersion: IDEA_TERMS_VERSION,
      marketingOptIn: true,
      attributionFirstSource: "fb",
      attributionFirstMedium: "paid",
      attributionFirstCampaign: "ideas_launch",
      attributionLastSource: "ig",
      attributionLastMedium: "social",
      attributionLastCampaign: "ideas_retarget",
    });
    expect(JSON.stringify(values)).not.toContain(CLIENT_IP);
  });

  it("looks the series up fresh: published, not deleted, by slug", async () => {
    await submitIdea(input());
    const lookup = h.selects.find((s) => s.table === "shows");
    expect(lookup).toBeDefined();
    const q = render(lookup?.where);
    expect(q.sql).toBe(
      '("shows"."slug" = $1 and "shows"."status" = $2 and "shows"."deleted_at" is null)',
    );
    expect(q.params).toEqual(["the-scarlet-oath", "published"]);
  });

  it("a brand-new series skips the show lookup and stores no show", async () => {
    await expect(submitIdea(input({ series: "new" }))).resolves.toEqual({
      ok: true,
      onList: false,
    });
    expect(h.selects.filter((s) => s.table === "shows")).toEqual([]);
    expect(h.inserts[0].values).toMatchObject({ kind: "new_series", showId: null });
  });

  it("stores the normalised text: CRLF → LF, ends trimmed, a blank title as NULL", async () => {
    await submitIdea(
      input({ workingTitle: "   ", story: "  line one\r\nline two\r\n ", name: " Ana " }),
    );
    expect(h.inserts[0].values).toMatchObject({
      workingTitle: null,
      story: "line one\nline two",
      authorName: "Ana",
    });
  });

  it("terms_version is the server's, whatever the client sends", async () => {
    const forged = { ...input(), termsVersion: "ideas-1999-forged" } as IdeaSubmissionInput;
    await submitIdea(forged);
    expect(h.inserts[0].values.termsVersion).toBe(IDEA_TERMS_VERSION);
  });
});

describe("submitIdea — idempotent on (email, content_hash)", () => {
  it("targets the natural key with ON CONFLICT DO NOTHING", async () => {
    await submitIdea(input());
    const { target } = h.inserts[0].conflict;
    expect(target).toHaveLength(2);
    expect(target[0]).toBe(ideaSubmissions.email);
    expect(target[1]).toBe(ideaSubmissions.contentHash);
  });

  it("a repeat answers ok with the STORED opt-in, not the resent tick", async () => {
    h.returned = []; // the conflict path: nothing inserted
    h.existing = [{ marketingOptIn: false }];

    const res = await submitIdea(input({ marketingOptIn: true }));

    expect(res).toEqual({ ok: true, onList: false });
    const read = h.selects.find((s) => s.table === "idea_submissions");
    expect(read).toBeDefined();
    const q = render(read?.where);
    expect(q.sql).toBe(
      '("idea_submissions"."email" = $1 and "idea_submissions"."content_hash" = $2)',
    );
    expect(q.params).toEqual(["ana@example.com", h.inserts[0].values.contentHash]);
  });

  it("a repeat whose stored row said yes answers yes", async () => {
    h.returned = [];
    h.existing = [{ marketingOptIn: true }];
    await expect(submitIdea(input())).resolves.toEqual({ ok: true, onList: true });
  });

  it("the same pitch hashes the same; a changed text hashes differently", async () => {
    await submitIdea(input());
    // Same pitch after normalisation, a different address case and opt-in:
    // none of that is the pitch.
    await submitIdea(
      input({ story: "  It begins at dawn.\r\n", email: "ANA@example.com", marketingOptIn: true }),
    );
    await submitIdea(input({ story: "It begins at dusk." }));
    await submitIdea(input({ series: "new" }));

    const [a, b, c, d] = h.inserts.map((i) => i.values.contentHash);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    expect(a).toBe(
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            "continuation",
            SHOW_ID,
            "The Last Letter",
            "What if a postman had one last letter to deliver?",
            "It begins at dawn.",
          ]),
        )
        .digest("hex"),
    );
  });
});

describe("submitIdea — refusals that never touch the brake", () => {
  it("the honeypot is checked BEFORE validation: a filled trap with junk everywhere still gets the silent success", async () => {
    const res = await submitIdea(
      input({
        website: "x",
        logline: "",
        email: "nope",
        ageConfirmed: false,
        termsAccepted: false,
      }),
    );

    expect(res).toEqual({ ok: true, onList: false });
    expect(h.rateLimited).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
    expect(consoleCalls()).toEqual([["submitIdea: honeypot"]]);
  });

  it("honeypot: a success that writes nothing, logged without data", async () => {
    const res = await submitIdea(input({ website: "https://spam.example" }));

    expect(res).toEqual({ ok: true, onList: false });
    expect(h.inserts).toEqual([]);
    expect(h.selects).toEqual([]);
    expect(h.rateLimited).not.toHaveBeenCalled();
    expect(consoleCalls()).toEqual([["submitIdea: honeypot"]]);
  });

  it("invalid input: typed errors, no brake, no database", async () => {
    const res = await submitIdea(input({ logline: "", email: "nope" }));

    expect(res).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "logline", code: "logline_required" },
        { field: "email", code: "email_invalid" },
      ],
    });
    expect(h.rateLimited).not.toHaveBeenCalled();
    expect(h.inserts).toEqual([]);
    expect(h.selects).toEqual([]);
  });

  it("without the 18+ and terms ticks: age_required and terms_required", async () => {
    await expect(
      submitIdea(input({ ageConfirmed: false, termsAccepted: false })),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "age", code: "age_required" },
        { field: "terms", code: "terms_required" },
      ],
    });
    expect(h.inserts).toEqual([]);
  });
});

describe("submitIdea — the series must be a published show", () => {
  it("an unknown or unpublished slug is series_unknown and writes nothing", async () => {
    h.showRows = [];
    await expect(submitIdea(input({ series: "draft-show" }))).resolves.toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "series", code: "series_unknown" }],
    });
    expect(h.inserts).toEqual([]);
  });
});

describe("submitIdea — the hourly brake", () => {
  it("over the limit: rate_limited, nothing written", async () => {
    h.rateLimited.mockResolvedValue(true);
    await expect(submitIdea(input())).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(h.inserts).toEqual([]);
    expect(h.selects).toEqual([]);
  });

  it("the key is `idea:` + the HMAC of the IP — never the IP itself", async () => {
    await submitIdea(input());
    expect(h.rateLimited).toHaveBeenCalledTimes(1);
    const [key, limit] = h.rateLimited.mock.calls[0];
    expect(key.startsWith("idea:")).toBe(true);
    expect(key).not.toContain(CLIENT_IP);
    expect(key).toBe(`idea:${hashClientIp(CLIENT_IP)}`);
    expect(limit).toBe(IDEA_RATELIMIT_PER_HOUR);
  });

  async function keyFor(ip: string) {
    h.headers = new Headers({ "x-vercel-forwarded-for": ip });
    h.rateLimited.mockClear();
    await submitIdea(input());
    return h.rateLimited.mock.calls[0][0];
  }

  it("an IPv6 client is counted per /64 — rotating inside its prefix buys no fresh bucket", async () => {
    const a = await keyFor("2001:db8:abcd:12:1::1");
    const b = await keyFor("2001:0db8:abcd:0012:ffff:ffff:ffff:fffe");
    const c = await keyFor("2001:db8:abcd:13::1");

    expect(a).toBe(b);
    expect(a).toBe(`idea:${hashClientIp("2001:db8:abcd:12::/64")}`);
    expect(c).not.toBe(a);
    for (const key of [a, c]) {
      expect(key).toMatch(/^idea:[0-9a-f]{64}$/);
      expect(key).not.toContain("2001");
    }
  });

  it("a compressed prefix expands before it is cut; IPv4 and IPv4-mapped stay per address", async () => {
    expect(await keyFor("2001:db8::7")).toBe(await keyFor("2001:db8:0:0:5::"));
    expect(await keyFor("2001:db8::7")).toBe(`idea:${hashClientIp("2001:db8:0:0::/64")}`);
    expect(await keyFor("::ffff:203.0.113.7")).toBe(`idea:${hashClientIp(CLIENT_IP)}`);
    expect(await keyFor("203.0.113.8")).not.toBe(await keyFor(CLIENT_IP));
  });
});

describe("submitIdea — a failing query never throws and reports codes only", () => {
  const SECRET_TEXT = "Leak Marker's secret story";

  it("an insert failure quoting the row: server_error, { name, code } from .cause", async () => {
    h.insertError = driverError(
      "42P01",
      `relation "idea_submissions" does not exist: insert … values ('Ana', 'ana@example.com', '${SECRET_TEXT}')`,
    );

    await expect(submitIdea(input({ story: SECRET_TEXT }))).resolves.toEqual({
      ok: false,
      reason: "server_error",
    });

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("submitIdea: failed", {
      name: "DrizzleQueryError",
      code: "42P01",
    });
    expect(h.sentryMessage).toHaveBeenCalledTimes(1);
    expect(h.sentryMessage).toHaveBeenCalledWith("submitIdea: failed", {
      level: "error",
      tags: { code: "42P01", name: "DrizzleQueryError" },
    });
    const out = JSON.stringify([consoleCalls(), h.sentryMessage.mock.calls]);
    expect(out).not.toContain(SECRET_TEXT);
    expect(out).not.toContain("ana@example.com");
  });

  it("a show lookup failure quoting the series: server_error, nothing written", async () => {
    const series = "slug-with-Leak-Marker";
    h.showError = driverError("57P01", `terminating connection while matching '${series}'`);

    await expect(submitIdea(input({ series }))).resolves.toEqual({
      ok: false,
      reason: "server_error",
    });

    expect(h.inserts).toEqual([]);
    expect(console.error).toHaveBeenCalledWith("submitIdea: failed", {
      name: "DrizzleQueryError",
      code: "57P01",
    });
    expect(h.sentryMessage).toHaveBeenCalledWith("submitIdea: failed", {
      level: "error",
      tags: { code: "57P01", name: "DrizzleQueryError" },
    });
    expect(JSON.stringify([consoleCalls(), h.sentryMessage.mock.calls])).not.toContain(series);
  });

  it("an error with no SQLSTATE anywhere reports code 'none'", async () => {
    h.insertError = new TypeError("fetch failed");
    await expect(submitIdea(input())).resolves.toEqual({
      ok: false,
      reason: "server_error",
    });
    expect(h.sentryMessage).toHaveBeenCalledWith("submitIdea: failed", {
      level: "error",
      tags: { code: "none", name: "TypeError" },
    });
  });
});
