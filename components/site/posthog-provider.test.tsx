/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONSENT_VERSION, type ConsentRecord } from "@/lib/cookie-consent";

// The provider dynamic-imports posthog-js after consent; the mock records the
// init call so the suite can read the options the real SDK would receive.
const ph = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock("posthog-js", () => ({ default: ph }));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isSignedIn: false, userId: null }),
  useUser: () => ({ user: null }),
}));
vi.mock("@/lib/i18n/client", () => ({ useLocale: () => "en" }));

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
