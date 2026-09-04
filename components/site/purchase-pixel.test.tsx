/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONSENT_VERSION,
  writeConsentToDocument,
} from "@/lib/cookie-consent";
import {
  OAIQ_MEMBERSHIP_PLAN_ID,
  OAIQ_READY_EVENT,
} from "@/lib/openai-pixel-events";

import { PurchasePixel } from "./purchase-pixel";

const consent = (marketing: boolean) =>
  writeConsentToDocument({ necessary: true, marketing, ts: 1, v: CONSENT_VERSION });

beforeEach(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  consent(true);
});

afterEach(() => {
  cleanup();
  delete window.oaiq;
  delete window.__oaiqReady;
});

describe("PurchasePixel — ChatGPT Ads subscription_created on checkout return", () => {
  it("measures the real charge once per subscription, keyed for server dedupe", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    const view = render(
      <PurchasePixel purchaseKey="sub_test_abc" amountCents={100} currency="usd" />,
    );
    expect(oaiq).toHaveBeenCalledWith(
      "measure",
      "subscription_created",
      {
        type: "plan_enrollment",
        plan_id: OAIQ_MEMBERSHIP_PLAN_ID,
        amount: 100,
        currency: "USD",
      },
      { event_id: "sub_test_abc" },
    );
    expect(oaiq).toHaveBeenCalledTimes(1);

    // A refresh of the return page must not double-count the purchase.
    view.unmount();
    render(
      <PurchasePixel purchaseKey="sub_test_abc" amountCents={100} currency="usd" />,
    );
    expect(oaiq).toHaveBeenCalledTimes(1);
  });

  it("waits for the SDK and never burns the flag while it is absent", () => {
    render(
      <PurchasePixel purchaseKey="sub_test_wait" amountCents={100} currency="usd" />,
    );
    expect(localStorage.getItem("matio:oaiq:purchase:sub_test_wait")).toBeNull();
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    window.dispatchEvent(new Event(OAIQ_READY_EVENT));
    expect(oaiq).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("matio:oaiq:purchase:sub_test_wait")).toBe("1");
  });

  it("does not measure — or burn the flag — without live marketing consent", () => {
    consent(false);
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    render(
      <PurchasePixel purchaseKey="sub_test_noc" amountCents={100} currency="usd" />,
    );
    expect(oaiq).not.toHaveBeenCalled();
    expect(localStorage.getItem("matio:oaiq:purchase:sub_test_noc")).toBeNull();
  });

  it("never sends a negative or fractional amount", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    render(
      <PurchasePixel purchaseKey="sub_test_amt" amountCents={99.6} currency="eur" />,
    );
    expect(oaiq.mock.calls[0][2]).toMatchObject({ amount: 100, currency: "EUR" });
  });
});
