import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveWalletGate,
  TOS_VERSION,
  TOS_VERSION_KEY,
  toConsentMetadata,
  walletCheckoutEnabled,
} from "./wallet-checkout";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("walletCheckoutEnabled", () => {
  it("is OFF unless the flag is exactly '1' — the vertical ships dark", () => {
    // The whole point of the kill-switch: anything other than an explicit
    // opt-in must leave the paywall with the CTA it has today, and must stop
    // any `ui_mode: 'elements'` session from ever being created.
    for (const value of ["", "0", "true", "yes", "on"]) {
      vi.stubEnv("WALLET_EXPRESS_CHECKOUT", value);
      expect(walletCheckoutEnabled()).toBe(false);
    }
  });

  it("is ON for '1'", () => {
    vi.stubEnv("WALLET_EXPRESS_CHECKOUT", "1");
    expect(walletCheckoutEnabled()).toBe(true);
  });

  it("is OFF when the variable is absent entirely", () => {
    vi.stubEnv("WALLET_EXPRESS_CHECKOUT", undefined);
    expect(walletCheckoutEnabled()).toBe(false);
  });
});

describe("toConsentMetadata", () => {
  it("records WHICH terms were accepted — and no time", () => {
    // Absent on purpose: a clock read in session metadata either breaks the
    // idempotency key (unique per call) or, rounded to keep the key stable,
    // back-dates the acceptance (#214). Stripe's session `created` is exact.
    expect(toConsentMetadata()).toEqual({ [TOS_VERSION_KEY]: TOS_VERSION });
  });

  it("is identical on every call, so the idempotency key stays stable", () => {
    expect(toConsentMetadata()).toEqual(toConsentMetadata());
  });

  it("carries nothing shaped like a clock reading", () => {
    for (const value of Object.values(toConsentMetadata())) {
      expect(value).not.toMatch(/T\d{2}:\d{2}/);
    }
  });

  it("emits only string values — Stripe metadata rejects anything else", () => {
    expect(
      Object.values(toConsentMetadata()).every((v) => typeof v === "string"),
    ).toBe(true);
  });
});

describe("resolveWalletGate", () => {
  // Every gate open. Each case below closes exactly one.
  const OPEN = {
    paymentsOn: true,
    flagOn: true,
    hasPublishableKey: true,
    inAppBrowser: false,
    signedIn: true,
    consentAccepted: true,
  };

  it("permits the wallet only when every condition holds", () => {
    expect(resolveWalletGate(OPEN)).toBe("ok");
  });

  it.each([
    ["payments off", { paymentsOn: false }, "payments_off"],
    ["kill-switch unset", { flagOn: false }, "flag_off"],
    ["no publishable key", { hasPublishableKey: false }, "no_publishable_key"],
    ["FB/IG webview", { inAppBrowser: true }, "in_app_browser"],
    ["signed out", { signedIn: false }, "anonymous"],
    ["consent unticked", { consentAccepted: false }, "consent_not_accepted"],
  ])("refuses when %s", (_label, override, expected) => {
    expect(resolveWalletGate({ ...OPEN, ...override })).toBe(expected);
  });

  it("reports payments_off ahead of every other refusal", () => {
    // The only verdict that redirects. If a narrower refusal outranked it, a
    // free-mode visitor could get `unavailable` and the paywall would quietly
    // keep a surface that must not exist at all while payments are off.
    expect(
      resolveWalletGate({
        paymentsOn: false,
        flagOn: false,
        hasPublishableKey: false,
        inAppBrowser: true,
        signedIn: false,
        consentAccepted: false,
      }),
    ).toBe("payments_off");
  });

  it("never returns ok for an anonymous buyer, whatever else is set", () => {
    // v1 is signed-in only: a guest wallet purchase also mints a Clerk account
    // and a sign-in ticket from the wallet's email.
    expect(resolveWalletGate({ ...OPEN, signedIn: false })).not.toBe("ok");
  });

  it("never returns ok without consent — Stripe cannot collect it here", () => {
    expect(resolveWalletGate({ ...OPEN, consentAccepted: false })).not.toBe("ok");
  });
});
