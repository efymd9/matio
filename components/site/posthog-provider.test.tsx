/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSION, type ConsentRecord } from "@/lib/cookie-consent";

// The provider dynamic-imports posthog-js after consent; the mock records the
// init call so the suite can read the options the real SDK would receive.
const ph = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("posthog-js", () => ({ default: ph }));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// Signed out unless a case signs in. The Clerk user always HAS an address —
// what is pinned below is that the provider never hands it to PostHog.
const clerk = vi.hoisted(() => ({
  isSignedIn: false as boolean,
  userId: null as string | null,
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isSignedIn: clerk.isSignedIn, userId: clerk.userId }),
  useUser: () => ({
    user: { primaryEmailAddress: { emailAddress: "viewer@example.invalid" } },
  }),
}));

// POSTHOG_KEY is a module-level env read — pinned here so the init path runs
// the same way locally (.env.local may hold a key) and in CI (it holds none).
vi.mock("@/lib/posthog-events", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/posthog-events")>();
  return { ...mod, POSTHOG_KEY: "phc_test_dummy" };
});

import { PostHogProvider } from "./posthog-provider";

const consented: ConsentRecord = {
  necessary: true,
  marketing: true,
  ts: 0,
  v: CONSENT_VERSION,
};

afterEach(() => {
  cleanup();
  ph.init.mockReset();
  clerk.isSignedIn = false;
  clerk.userId = null;
  delete (window as { posthog?: unknown }).posthog;
});

async function initOptions(): Promise<Record<string, unknown>> {
  render(<PostHogProvider initialConsent={consented} />);
  await waitFor(() => expect(ph.init).toHaveBeenCalledTimes(1));
  const [key, options] = ph.init.mock.calls[0];
  expect(key).toBe("phc_test_dummy");
  return options as Record<string, unknown>;
}

describe("PostHogProvider — init options", () => {
  it("turns feature flags off, so no /flags request carries the visitor's ids (#295)", async () => {
    const options = await initOptions();
    expect(options.advanced_disable_feature_flags).toBe(true);
  });

  it("keeps remote config: neither advanced_disable_flags nor its deprecated alias is set", async () => {
    // Both would also switch off remote config, and with it the session
    // replay and heatmaps enabled below.
    const options = await initOptions();
    expect(options.advanced_disable_flags).toBeUndefined();
    expect(options.advanced_disable_decide).toBeUndefined();
    expect(options.disable_session_recording).toBe(false);
    expect(options.enable_heatmaps).toBe(true);
  });
});

// #445 — the site is English-only, so the language super-properties are gone;
// posthog-js persists super-properties, so the stale ones a returning browser
// still holds are dropped before the first event.
describe("PostHogProvider — no language super-properties", () => {
  it("unregisters locale / locale_source on load, registers nothing, then sends the first $pageview", async () => {
    const options = await initOptions();
    const calls: string[] = [];
    const sdk = {
      unregister: vi.fn((p: string) => calls.push(`unregister:${p}`)),
      register: vi.fn(() => calls.push("register")),
      capture: vi.fn((e: string) => calls.push(`capture:${e}`)),
      opt_out_capturing: vi.fn(),
    };

    await act(async () => {
      (options.loaded as (instance: typeof sdk) => void)(sdk);
    });

    expect(sdk.register).not.toHaveBeenCalled();
    expect(calls).toEqual([
      "unregister:locale",
      "unregister:locale_source",
      "capture:$pageview",
    ]);
  });
});

// #466 — the person PostHog keeps is the Clerk id and nothing else: identify()
// gets no person properties, so no email address reaches the processor.
describe("PostHogProvider — identify sends the id only", () => {
  it("identifies a signed-in viewer by the Clerk id, with no email or other property", async () => {
    clerk.isSignedIn = true;
    clerk.userId = "user_1";
    const options = await initOptions();
    const sdk = {
      identify: vi.fn(),
      unregister: vi.fn(),
      register: vi.fn(),
      capture: vi.fn(),
      reset: vi.fn(),
      opt_out_capturing: vi.fn(),
    };

    await act(async () => {
      (options.loaded as (instance: typeof sdk) => void)(sdk);
    });

    await waitFor(() => expect(sdk.identify).toHaveBeenCalledTimes(1));
    expect(sdk.identify.mock.calls[0]).toEqual(["user_1"]);
    expect(JSON.stringify(sdk.identify.mock.calls)).not.toContain("@");
    expect(sdk.register).not.toHaveBeenCalled();
  });
});
