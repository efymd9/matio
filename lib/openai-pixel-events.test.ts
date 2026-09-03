/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  measureOaiq,
  OAIQ_READY_EVENT,
  onOaiqReady,
} from "./openai-pixel-events";

// The helper is the ONE place the consent gate is enforced for call sites: a
// measure call must be a silent no-op until the consent-gated loader has
// defined window.oaiq — never a crash, never a queued-then-flushed event.

afterEach(() => {
  delete window.oaiq;
  delete window.__oaiqReady;
});

describe("measureOaiq", () => {
  it("is a no-op before the SDK is loaded (no consent → nothing ever fires)", () => {
    expect(() =>
      measureOaiq("page_viewed", { type: "contents" }),
    ).not.toThrow();
  });

  it("forwards the documented shape once the SDK is present", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    measureOaiq("page_viewed", { type: "contents" });
    expect(oaiq).toHaveBeenCalledWith("measure", "page_viewed", {
      type: "contents",
    });
  });

  it("passes options as the fourth argument only when given", () => {
    const oaiq = vi.fn();
    window.oaiq = oaiq as unknown as NonNullable<typeof window.oaiq>;
    measureOaiq(
      "subscription_created",
      { type: "plan_enrollment", plan_id: "free-membership" },
      { event_id: "signup:user_1" },
    );
    expect(oaiq).toHaveBeenCalledWith(
      "measure",
      "subscription_created",
      { type: "plan_enrollment", plan_id: "free-membership" },
      { event_id: "signup:user_1" },
    );
  });
});

describe("onOaiqReady", () => {
  it("runs immediately when the SDK is already loaded", () => {
    window.oaiq = vi.fn() as unknown as NonNullable<typeof window.oaiq>;
    const cb = vi.fn();
    onOaiqReady(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("waits for the ready event otherwise, and the cleanup detaches it", () => {
    const cb = vi.fn();
    const off = onOaiqReady(cb);
    expect(cb).not.toHaveBeenCalled();
    window.dispatchEvent(new Event(OAIQ_READY_EVENT));
    expect(cb).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    const offLate = onOaiqReady(late);
    offLate();
    window.dispatchEvent(new Event(OAIQ_READY_EVENT));
    expect(late).not.toHaveBeenCalled();
    off();
  });
});
