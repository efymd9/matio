import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveWalletGate,
  TOS_ACCEPTED_AT_KEY,
  TOS_VERSION,
  TOS_VERSION_KEY,
  toWaiverMetadata,
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

describe("toWaiverMetadata", () => {
  it("records WHEN the buyer accepted and WHICH wording they saw", () => {
    // Stripe cannot render the waiver on the wallet surface, so this record is
    // the only evidence that the buyer consented to immediate supply. Both
    // halves matter: a timestamp with no version cannot be tied to the text
    // that was on screen.
    const at = new Date("2026-09-09T10:11:12.000Z");

    expect(toWaiverMetadata(at)).toEqual({
      [TOS_ACCEPTED_AT_KEY]: "2026-09-09T10:11:12.000Z",
      [TOS_VERSION_KEY]: TOS_VERSION,
    });
  });

  it("is pure — the clock is the caller's, never read in here", () => {
    const at = new Date("2020-01-01T00:00:00.000Z");

    expect(toWaiverMetadata(at)).toEqual(toWaiverMetadata(at));
    expect(toWaiverMetadata(at)[TOS_ACCEPTED_AT_KEY]).toBe(at.toISOString());
  });

  it("emits only string values — Stripe metadata rejects anything else", () => {
    const meta = toWaiverMetadata(new Date(0));

    expect(Object.values(meta).every((v) => typeof v === "string")).toBe(true);
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
    waiverAccepted: true,
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
    ["waiver unticked", { waiverAccepted: false }, "waiver_not_accepted"],
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
        waiverAccepted: false,
      }),
    ).toBe("payments_off");
  });

  it("never returns ok for an anonymous buyer, whatever else is set", () => {
    // v1 is signed-in only: a guest wallet purchase also mints a Clerk account
    // and a sign-in ticket from the wallet's email.
    expect(resolveWalletGate({ ...OPEN, signedIn: false })).not.toBe("ok");
  });

  it("never returns ok without the waiver — Stripe cannot collect it here", () => {
    expect(resolveWalletGate({ ...OPEN, waiverAccepted: false })).not.toBe("ok");
  });
});
