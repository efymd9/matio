import crypto from "node:crypto";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The /careers submit action (#376). What is under test is what reaches the
// database and what leaves the process: exactly one row with exactly the
// columns the data map lists (no IP, no user id), the natural-key dedupe —
// against a fake table that ENFORCES the unique key, so "one row" is counted,
// not assumed — the hourly brake against a fake counter that counts, the
// order of the cheap refusals (honeypot and validation never touch the
// brake), and the never-throw contract.
const h = vi.hoisted(() => ({
  headers: new Headers(),
  sentryMessage: vi.fn(),
  // The stored table, and the unique key it enforces.
  rows: [] as Record<string, unknown>[],
  insertError: undefined as unknown,
  conflictTargets: [] as unknown[][],
  // The brake's counter: key → calls this hour.
  counts: new Map<string, number>(),
  brakeError: undefined as unknown,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentryMessage }));
vi.mock("next/headers", () => ({ headers: async () => h.headers }));
// The real brake's contract (lib/checkout-rate-limit.ts): every call counts,
// over the limit = true. Kept in memory, so the 6th call is really the 6th.
vi.mock("@/lib/checkout-rate-limit", () => ({
  checkoutRateLimited: async (key: string, limit: number) => {
    if (h.brakeError) throw h.brakeError;
    const n = (h.counts.get(key) ?? 0) + 1;
    h.counts.set(key, n);
    return n > limit;
  },
}));
vi.mock("@/db", () => ({
  db: {
    insert: (table: PgTable) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoNothing: async (conflict: { target: unknown[] }) => {
          if (getTableName(table) !== "job_applications") throw new Error("wrong table");
          h.conflictTargets.push(conflict.target);
          if (h.insertError) throw h.insertError;
          const clash = h.rows.some(
            (r) =>
              r.email === values.email &&
              r.position === values.position &&
              r.contentHash === values.contentHash,
          );
          if (!clash) h.rows.push(values);
        },
      }),
    }),
  },
}));

import { jobApplications } from "@/db/schema";
import {
  JOB_APPLICATION_RATELIMIT_PER_HOUR,
  type JobApplicationInput,
} from "@/lib/job-application";
import { hashClientIp } from "@/lib/trial";
import { submitJobApplication } from "./actions";

const CLIENT_IP = "203.0.113.7";

function input(over: Partial<JobApplicationInput> = {}): JobApplicationInput {
  return {
    position: "ai-creator",
    fullName: "Ana Rivera",
    email: "Ana@Example.COM",
    location: "Madrid, Spain",
    linkedinUrl: "https://www.linkedin.com/in/ana-rivera",
    portfolioUrl: "https://vimeo.com/ana",
    socials: [
      { platform: "tiktok", value: "@ana.films" },
      { platform: "youtube", value: "" },
    ],
    message: "I make dark short films with generative tools.",
    ageConfirmed: true,
    website: "",
    ...over,
  };
}

/** What the driver throws through Drizzle 0.44+: the PostgresError sits on `.cause`. */
function driverError(code: string, message: string) {
  const cause = Object.assign(new Error(message), { name: "PostgresError", code });
  return Object.assign(new Error(`Failed query: ${message}`), {
    name: "DrizzleQueryError",
    cause,
  });
}

beforeEach(() => {
  h.headers = new Headers({ "x-vercel-forwarded-for": CLIENT_IP });
  h.sentryMessage.mockReset();
  h.rows = [];
  h.insertError = undefined;
  h.conflictTargets = [];
  h.counts = new Map();
  h.brakeError = undefined;
  for (const level of ["error", "warn", "info", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitJobApplication — the happy path", () => {
  it("writes exactly one row with exactly the data map's columns — no IP, no user id, no country", async () => {
    const res = await submitJobApplication(input());

    expect(res).toEqual({ ok: true });
    expect(h.rows).toHaveLength(1);
    const [row] = h.rows;
    expect(Object.keys(row).sort()).toEqual(
      [
        "contentHash",
        "email",
        "fullName",
        "linkedinUrl",
        "location",
        "message",
        "portfolioUrl",
        "position",
        "socialLinks",
      ].sort(),
    );
    expect(row).toMatchObject({
      position: "ai-creator",
      fullName: "Ana Rivera",
      // Stored lowercased: erasure and export compare against lower(address).
      email: "ana@example.com",
      location: "Madrid, Spain",
      linkedinUrl: "https://www.linkedin.com/in/ana-rivera",
      portfolioUrl: "https://vimeo.com/ana",
      // The blank row is dropped, not stored.
      socialLinks: [{ platform: "tiktok", value: "@ana.films" }],
      message: "I make dark short films with generative tools.",
    });
    expect(JSON.stringify(row)).not.toContain(CLIENT_IP);
  });

  it("Sales & Distribution without a portfolio passes, with blank links stored as NULL", async () => {
    const res = await submitJobApplication(
      input({ position: "sales-distribution", portfolioUrl: "", linkedinUrl: "  ", socials: [] }),
    );

    expect(res).toEqual({ ok: true });
    expect(h.rows[0]).toMatchObject({
      position: "sales-distribution",
      linkedinUrl: null,
      portfolioUrl: null,
      socialLinks: [],
    });
  });
});

describe("submitJobApplication — idempotent on (email, position, content_hash)", () => {
  it("targets the natural key with ON CONFLICT DO NOTHING", async () => {
    await submitJobApplication(input());
    expect(h.conflictTargets[0]).toEqual([
      jobApplications.email,
      jobApplications.position,
      jobApplications.contentHash,
    ]);
  });

  it("a repeat of the same text (a double tap, a lost answer) is the same one row and the same ok", async () => {
    const first = await submitJobApplication(input());
    // The same application after normalisation: another address case, CRLF,
    // spaces at the ends.
    const second = await submitJobApplication(
      input({
        email: "ana@example.com",
        message: "  I make dark short films with generative tools.\r\n",
      }),
    );

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(h.rows).toHaveLength(1);
  });

  it("a changed text, or the same text for the other role, is a new row", async () => {
    await submitJobApplication(input());
    await submitJobApplication(input({ message: "Another take." }));
    await submitJobApplication(input({ position: "sales-distribution" }));

    expect(h.rows).toHaveLength(3);
    const [a, b] = h.rows.map((r) => r.contentHash);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(a);
    // The hash covers the application's own content, not the key's address.
    expect(a).toBe(
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            "Ana Rivera",
            "Madrid, Spain",
            "https://www.linkedin.com/in/ana-rivera",
            "https://vimeo.com/ana",
            [["tiktok", "@ana.films"]],
            "I make dark short films with generative tools.",
          ]),
        )
        .digest("hex"),
    );
  });
});

describe("submitJobApplication — the cheap refusals", () => {
  it("honeypot: a filled trap answers ok, writes nothing and never touches the brake", async () => {
    const res = await submitJobApplication(input({ website: "https://bot.example.invalid" }));

    expect(res).toEqual({ ok: true });
    expect(h.rows).toEqual([]);
    expect(h.counts.size).toBe(0);
    expect(console.info).toHaveBeenCalledWith("submitJobApplication: honeypot");
  });

  it("an empty send answers every required field, writes nothing and spends no brake budget", async () => {
    const res = await submitJobApplication({
      position: "",
      fullName: "",
      email: "",
      location: "",
      linkedinUrl: "",
      portfolioUrl: "",
      socials: [],
      message: "",
      ageConfirmed: false,
      website: "",
    });

    expect(res).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "position", code: "position_required" },
        { field: "fullName", code: "name_required" },
        { field: "email", code: "email_required" },
        { field: "location", code: "location_required" },
        { field: "message", code: "message_required" },
        { field: "age", code: "age_required" },
      ],
    });
    expect(h.rows).toEqual([]);
    expect(h.counts.size).toBe(0);
  });

  it("refuses AI Creator without a portfolio, a javascript: link and a fifth profile", async () => {
    expect(await submitJobApplication(input({ portfolioUrl: "" }))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "portfolio", code: "portfolio_required" }],
    });
    expect(await submitJobApplication(input({ linkedinUrl: "javascript:alert(1)" }))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "linkedin", code: "linkedin_invalid" }],
    });
    const five = ["tiktok", "instagram", "youtube", "x", "other"].map((platform) => ({
      platform,
      value: `@${platform}`,
    }));
    expect(await submitJobApplication(input({ socials: five }))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "socials", code: "socials_too_many" }],
    });
    expect(h.rows).toEqual([]);
  });
});

describe("submitJobApplication — the hourly brake", () => {
  it("the 6th application from one IP in an hour is rate_limited and writes no row", async () => {
    const results = [];
    for (let i = 1; i <= JOB_APPLICATION_RATELIMIT_PER_HOUR + 1; i++) {
      results.push(await submitJobApplication(input({ message: `Application number ${i}.` })));
    }

    expect(JOB_APPLICATION_RATELIMIT_PER_HOUR).toBe(5);
    expect(results.slice(0, 5)).toEqual(Array(5).fill({ ok: true }));
    expect(results[5]).toEqual({ ok: false, reason: "rate_limited" });
    expect(h.rows).toHaveLength(5);
    expect(h.rows.map((r) => r.message)).not.toContain("Application number 6.");
  });

  it("counts under `job:` + the HMAC of the IP bucket — never the IP itself, never the idea or checkout keys", async () => {
    await submitJobApplication(input());

    expect([...h.counts.keys()]).toEqual([`job:${hashClientIp(CLIENT_IP)}`]);
    expect([...h.counts.keys()][0]).not.toContain(CLIENT_IP);
  });

  it("another IP has its own budget", async () => {
    for (let i = 0; i < JOB_APPLICATION_RATELIMIT_PER_HOUR; i++) {
      await submitJobApplication(input({ message: `From the first IP ${i}.` }));
    }
    h.headers = new Headers({ "x-vercel-forwarded-for": "198.51.100.9" });

    expect(await submitJobApplication(input({ message: "From another IP." }))).toEqual({
      ok: true,
    });
  });
});

describe("submitJobApplication — never throws", () => {
  it("an insert failure answers server_error and reports class + SQLSTATE only — no form value", async () => {
    h.insertError = driverError(
      "42P01",
      `relation "job_applications" does not exist — insert ('Ana Rivera', 'ana@example.com')`,
    );

    const res = await submitJobApplication(input());

    expect(res).toEqual({ ok: false, reason: "server_error" });
    expect(console.error).toHaveBeenCalledWith("submitJobApplication: failed", {
      name: "DrizzleQueryError",
      code: "42P01",
    });
    expect(h.sentryMessage).toHaveBeenCalledWith("submitJobApplication: failed", {
      level: "error",
      tags: { code: "42P01", name: "DrizzleQueryError" },
    });
    const everything = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      h.sentryMessage.mock.calls,
    ]);
    expect(everything).not.toContain("ana@example.com");
    expect(everything).not.toContain("Ana Rivera");
  });

  it("a failure with no SQLSTATE is tagged `none`, and a non-Error throw still resolves", async () => {
    h.brakeError = "a string, not an Error";

    const res = await submitJobApplication(input());

    expect(res).toEqual({ ok: false, reason: "server_error" });
    expect(h.sentryMessage.mock.calls[0][1]).toMatchObject({ tags: { code: "none" } });
    expect(h.rows).toEqual([]);
  });
});
