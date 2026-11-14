import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The /studio and /licensing actions (#498): what reaches the studio inbox
// (the subject, the fields, the Reply-To), the order of the cheap refusals
// (honeypot and validation never touch the brake), the hourly brake against
// a fake counter that counts, and the never-throw contract.
const h = vi.hoisted(() => ({
  headers: new Headers({ "x-vercel-forwarded-for": "203.0.113.7" }),
  counts: new Map<string, number>(),
  sent: [] as unknown[],
  sendOutcome: { ok: true } as { ok: true } | { ok: false; code: string },
  shows: [] as { slug: string; title: string }[],
  sentry: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentry }));
vi.mock("next/headers", () => ({ headers: async () => h.headers }));
vi.mock("@/lib/checkout-rate-limit", () => ({
  checkoutRateLimited: async (key: string, limit: number) => {
    const n = (h.counts.get(key) ?? 0) + 1;
    h.counts.set(key, n);
    return n > limit;
  },
}));
vi.mock("@/lib/b2b-enquiry-email", () => ({
  sendEnquiryEmail: async (e: unknown) => {
    h.sent.push(e);
    return h.sendOutcome;
  },
}));
vi.mock("@/lib/catalog", () => ({ getPublishedShows: async () => h.shows }));
vi.mock("@/lib/licensing", () => ({ LICENSING_SLUGS: ["the-scarlet-oath"] }));

import { ENQUIRY_RATELIMIT_PER_HOUR } from "@/lib/b2b-enquiry";
import { requestScreener } from "../licensing/actions";
import { submitStudioBrief } from "./actions";

const brief = (over = {}) => ({
  name: " Ana Rivera ",
  email: "Ana@Studio.example",
  projectType: "vfx",
  brief: "Twelve shots of set extension.",
  timeline: "Spring",
  budget: "25k-100k",
  website: "",
  ...over,
});
const screener = (over = {}) => ({
  title: "the-scarlet-oath",
  name: "Ana Rivera",
  company: "Northern Screens",
  email: "ana@northern.example",
  market: "Nordics",
  website: "",
  ...over,
});

beforeEach(() => {
  h.counts.clear();
  h.sent = [];
  h.sendOutcome = { ok: true };
  h.shows = [{ slug: "the-scarlet-oath", title: "THE SCARLET OATH" }];
  h.sentry.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitStudioBrief", () => {
  it("emails one brief: our label in the subject, the sender as Reply-To, the brief as the body", async () => {
    expect(await submitStudioBrief(brief())).toEqual({ ok: true });
    expect(h.sent).toEqual([
      {
        kind: "studio",
        subject: "Studio brief — VFX for existing footage",
        replyTo: "ana@studio.example",
        fields: [
          ["Name", "Ana Rivera"],
          ["Email", "ana@studio.example"],
          ["Project type", "VFX for existing footage"],
          ["Timeline", "Spring"],
          ["Budget range", "$25k – $100k"],
        ],
        body: "Brief:\nTwelve shots of set extension.",
      },
    ]);
  });

  it("a filled honeypot is a silent success: nothing sent, the brake untouched", async () => {
    expect(await submitStudioBrief(brief({ website: "x" }))).toEqual({ ok: true });
    expect(h.sent).toEqual([]);
    expect(h.counts.size).toBe(0);
  });

  it("an invalid brief answers its codes without touching the brake", async () => {
    expect(await submitStudioBrief(brief({ projectType: "", brief: "" }))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { field: "projectType", code: "required" },
        { field: "brief", code: "required" },
      ],
    });
    expect(h.counts.size).toBe(0);
  });

  it("the brake allows the hourly budget, then refuses without sending", async () => {
    for (let i = 0; i < ENQUIRY_RATELIMIT_PER_HOUR; i++) {
      expect(await submitStudioBrief(brief({ brief: `shot ${i}` }))).toEqual({ ok: true });
    }
    expect(await submitStudioBrief(brief())).toEqual({ ok: false, reason: "rate_limited" });
    expect(h.sent).toHaveLength(ENQUIRY_RATELIMIT_PER_HOUR);
    // The two forms keep separate budgets.
    expect(await requestScreener(screener())).toEqual({ ok: true });
  });

  it("a failed send is a server_error and a Sentry message, never a throw", async () => {
    h.sendOutcome = { ok: false, code: "not_configured" };
    await expect(submitStudioBrief(brief())).resolves.toEqual({ ok: false, reason: "server_error" });
    expect(h.sentry).toHaveBeenCalledWith("submitEnquiry: failed", {
      level: "error",
      tags: { kind: "studio", code: "not_configured" },
    });
  });

  it("a missing input object resolves to validation codes", async () => {
    const res = await submitStudioBrief(undefined as never);
    expect(res).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("requestScreener", () => {
  it("names the title in the subject and the body, resolved on the server from the slug", async () => {
    expect(await requestScreener(screener())).toEqual({ ok: true });
    expect(h.sent).toEqual([
      {
        kind: "screener",
        subject: "Screener request — THE SCARLET OATH",
        replyTo: "ana@northern.example",
        fields: [
          ["Title", "THE SCARLET OATH (https://matio.tv/shows/the-scarlet-oath)"],
          ["Name", "Ana Rivera"],
          ["Company", "Northern Screens"],
          ["Work email", "ana@northern.example"],
          ["Market / territory", "Nordics"],
        ],
      },
    ]);
  });

  it("no title = a catalogue enquiry; a title off the list is refused", async () => {
    await requestScreener(screener({ title: "" }));
    expect((h.sent[0] as { subject: string }).subject).toBe("Screener request — catalogue");
    expect(await requestScreener(screener({ title: "fallen" }))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [{ field: "title", code: "invalid_choice" }],
    });
  });

  it("a listed title that left the catalogue still goes out, under its slug", async () => {
    h.shows = [];
    await requestScreener(screener());
    expect((h.sent[0] as { subject: string }).subject).toBe("Screener request — the-scarlet-oath");
  });

  it("a catalogue read that throws is a server_error, never a throw", async () => {
    h.shows = null as never;
    await expect(requestScreener(screener())).resolves.toEqual({ ok: false, reason: "server_error" });
  });
});
