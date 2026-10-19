import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #466 — the attribution cookies are READ only under marketing consent, the
// same way proxy.ts writes them. Until #466 proxy.ts wrote them outside the
// EU/EEA/UK/CH under a `marketing: true` record of its own (version 1); those
// records now read as "no choice yet", but the cookies they let through can
// still sit in the browser for up to 90 days. Without the read gate such a
// leftover would be stamped into trial_sessions / users / Stripe metadata
// before the visitor ever answered the banner.

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = store.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { CONSENT_VERSION, serializeConsent } from "@/lib/cookie-consent";
import {
  EMPTY_ATTRIBUTION,
  readAttributionCookies,
  readAttributionCookiesFromRequest,
} from "./attribution";

const FIRST = JSON.stringify({ s: "tiktok", m: "paid_social", c: "launch" });
const LAST = JSON.stringify({ s: "ig", c: "retarget" });

const consent = (marketing: boolean, v: number = CONSENT_VERSION) =>
  v === CONSENT_VERSION
    ? serializeConsent({ necessary: true, marketing, ts: 1, v: CONSENT_VERSION })
    : JSON.stringify({ necessary: true, marketing, ts: 1, v });

const CASES = [
  ["no consent record", undefined],
  ["a v1 record that says yes (the old geo default)", consent(true, 1)],
  ["an explicit «Essential only»", consent(false)],
] as const;

function request(consentRaw: string | undefined): NextRequest {
  const parts = [
    `attribution_first=${encodeURIComponent(FIRST)}`,
    `attribution_last=${encodeURIComponent(LAST)}`,
  ];
  if (consentRaw) parts.push(`cookie_consent=${encodeURIComponent(consentRaw)}`);
  return new NextRequest("https://matio.tv/api/playback-token", {
    headers: { cookie: parts.join("; ") },
  });
}

const EXPECTED = {
  first: { source: "tiktok", medium: "paid_social", campaign: "launch" },
  last: { source: "ig", medium: null, campaign: "retarget" },
};
const NOTHING = { first: EMPTY_ATTRIBUTION, last: EMPTY_ATTRIBUTION };

describe("readAttributionCookiesFromRequest — only under consent (#466)", () => {
  it.each(CASES)("reads nothing with %s", (_label, raw) => {
    expect(readAttributionCookiesFromRequest(request(raw))).toEqual(NOTHING);
  });

  it("reads both snapshots under an «Accept all» of the current version", () => {
    expect(readAttributionCookiesFromRequest(request(consent(true)))).toEqual(EXPECTED);
  });
});

describe("readAttributionCookies — only under consent (#466)", () => {
  beforeEach(() => {
    store.cookies = new Map([
      ["attribution_first", FIRST],
      ["attribution_last", LAST],
    ]);
  });

  it.each(CASES)("reads nothing with %s", async (_label, raw) => {
    if (raw) store.cookies.set("cookie_consent", raw);
    expect(await readAttributionCookies()).toEqual(NOTHING);
  });

  it("reads both snapshots under an «Accept all» of the current version", async () => {
    store.cookies.set("cookie_consent", consent(true));
    expect(await readAttributionCookies()).toEqual(EXPECTED);
  });
});
