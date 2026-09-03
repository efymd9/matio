/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONSENT_VERSION,
  writeConsentToDocument,
} from "@/lib/cookie-consent";
import { OAIQ_READY_EVENT } from "@/lib/openai-pixel-events";

import { CompleteRegistrationPixel } from "./complete-registration-pixel";

const consent = (marketing: boolean) =>
  writeConsentToDocument({ necessary: true, marketing, ts: 1, v: CONSENT_VERSION });

// The account-materialization beacon: one conversion per user, per tracker,
// and only once the consent-gated SDK is actually present.

// vitest's jsdom exposes `localStorage` as a global getter that can come back
// undefined; the component tolerates that (try/catch), but the dedupe
// assertion below needs a real store, so pin an in-memory one.
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
  });
  consent(true);
});

afterEach(() => {
  cleanup();
  delete window.oaiq;
  delete window.__oaiqReady;
  delete window.fbq;
});

describe("CompleteRegistrationPixel — ChatGPT Ads conversion", () => {
  it("measures subscription_created once per user with a dedupe event_id", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    const view = render(<CompleteRegistrationPixel userId="user_42" />);
    expect(oaiq).toHaveBeenCalledWith(
      "measure",
      "subscription_created",
      { type: "plan_enrollment", plan_id: "free-membership" },
      { event_id: "signup:user_42" },
    );
    expect(oaiq).toHaveBeenCalledTimes(1);

    // A reload / second mount for the same user must not fire again.
    view.unmount();
    render(<CompleteRegistrationPixel userId="user_42" />);
    expect(oaiq).toHaveBeenCalledTimes(1);
  });

  it("waits for the SDK: zero calls before ready, exactly one after", () => {
    render(<CompleteRegistrationPixel userId="user_7" />);
    // No SDK yet → the ready-deferral is armed, nothing measured, and the
    // localStorage flag is NOT burned, so a later load still converts.
    expect(localStorage.getItem("matio:oaiq:signup:user_7")).toBeNull();
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    expect(oaiq).not.toHaveBeenCalled();
    window.dispatchEvent(new Event(OAIQ_READY_EVENT));
    expect(oaiq).toHaveBeenCalledTimes(1);
    expect(oaiq.mock.calls[0][1]).toBe("subscription_created");
    expect(localStorage.getItem("matio:oaiq:signup:user_7")).toBe("1");
  });

  it("does not measure — or burn the dedupe flag — after consent was withdrawn mid-session", () => {
    // The SDK stays loaded after a withdrawal but drops every event; burning
    // the flag then would lose the conversion forever.
    consent(false);
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    render(<CompleteRegistrationPixel userId="user_9" />);
    expect(oaiq).not.toHaveBeenCalledWith(
      "measure",
      "subscription_created",
      expect.anything(),
      expect.anything(),
    );
    expect(localStorage.getItem("matio:oaiq:signup:user_9")).toBeNull();
  });

  it("does nothing without a user id", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    render(<CompleteRegistrationPixel userId="" />);
    expect(oaiq).not.toHaveBeenCalled();
  });
});
