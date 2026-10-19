/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  CONSENT_VERSION,
  clearMarketingCookies,
  hasMarketingConsent,
  parseConsent,
  readConsentFromDocument,
  serializeConsent,
} from "./cookie-consent";

afterEach(() => {
  for (const name of ["attribution_first", "_fbp", "muxData", "cookie_consent"]) {
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

describe("clearMarketingCookies", () => {
  it("expires the Mux Data viewer cookie with the rest of the marketing set, and only those", () => {
    // What a consented visit leaves behind: our attribution pair, the Meta
    // browser id, and mux-embed's `muxData` (listed under Marketing on
    // /cookies — issue #127 found withdrawal leaving it in place).
    for (const name of ["attribution_first", "_fbp", "muxData"]) {
      document.cookie = `${name}=x; path=/`;
    }
    document.cookie = "cookie_consent=keep; path=/";
    expect(document.cookie).toContain("muxData=x");

    clearMarketingCookies();

    expect(document.cookie).not.toContain("muxData=");
    expect(document.cookie).not.toContain("_fbp=");
    expect(document.cookie).not.toContain("attribution_first=");
    // The consent record itself is strictly necessary and must survive.
    expect(document.cookie).toContain("cookie_consent=keep");
  });
});

// #466 — until then proxy.ts wrote `marketing: true` by itself outside the
// EU/EEA/UK/CH, as version 1. Such a record cannot be told apart from a real
// «Accept all», so the version moved to 2 and every v1 record — whichever way
// it came to be — reads as "no choice yet": the banner asks again, and every
// gate that asks hasMarketingConsent says no until the visitor answers.
describe("a consent record of an older version (#466)", () => {
  const v1 = (marketing: boolean) =>
    JSON.stringify({ necessary: true, marketing, ts: 1_700_000_000_000, v: 1 });

  it("is at version 2", () => {
    expect(CONSENT_VERSION).toBe(2);
  });

  it("parses to null and grants no marketing consent — even one that says yes", () => {
    expect(parseConsent(v1(true))).toBeNull();
    expect(parseConsent(v1(false))).toBeNull();
    expect(hasMarketingConsent(v1(true))).toBe(false);
  });

  it("reads as no choice from the browser too — what the loaders and Mux Data see", () => {
    document.cookie = `cookie_consent=${encodeURIComponent(v1(true))}; path=/`;
    expect(readConsentFromDocument()).toBeNull();
  });

  it("a record of the current version still counts, both ways", () => {
    const yes = serializeConsent({ necessary: true, marketing: true, ts: 5, v: CONSENT_VERSION });
    const no = serializeConsent({ necessary: true, marketing: false, ts: 5, v: CONSENT_VERSION });
    expect(parseConsent(yes)).toEqual({ necessary: true, marketing: true, ts: 5, v: 2 });
    expect(hasMarketingConsent(yes)).toBe(true);
    expect(hasMarketingConsent(no)).toBe(false);
    document.cookie = `cookie_consent=${encodeURIComponent(yes)}; path=/`;
    expect(readConsentFromDocument()?.marketing).toBe(true);
  });
});
