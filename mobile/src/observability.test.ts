import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// #317 — the app's error tracker. The web's contract, in the app: no DSN = no
// SDK at all; with one, the init options pin the privacy settings and the
// scrubbers from lib/observability.ts, and an event shaped the way the React
// Native SDK builds one leaves with no address and no query string in it.

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

vi.mock("@sentry/react-native", () => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" }, nativeBuildVersion: "7" },
}));

import * as Sentry from "@sentry/react-native";
import type { ReactNativeOptions } from "@sentry/react-native";
import {
  captureCrash,
  initObservability,
  resetObservabilityForTests,
  resolveAppEnvironment,
  resolveAppRelease,
  type ObservabilityEnv,
} from "./observability";
import { readObservabilityEnv } from "./observability-env";
import type { SentryEventLike } from "@/shared/observability";

type RnExceptionValue = { stacktrace?: { frames?: { filename?: string }[] } };

const init = vi.mocked(Sentry.init);
const captureException = vi.mocked(Sentry.captureException);
const load = vi.fn(() => Sentry);

// A DSN that is obviously not one (the nightly gitleaks scan).
const DSN = "https://dummy@sentry.invalid/1";
const ENV: ObservabilityEnv = {
  dsn: DSN,
  appEnv: undefined,
  isDev: false,
  version: "0.1.0",
  build: 7,
};

// The options the app handed to Sentry.init.
function started(env: ObservabilityEnv = ENV) {
  expect(initObservability(env, load)).toBe(true);
  expect(init).toHaveBeenCalledTimes(1);
  return init.mock.calls[0]![0] as ReactNativeOptions & Record<string, unknown>;
}

beforeEach(() => {
  init.mockClear();
  captureException.mockClear();
  load.mockClear();
  resetObservabilityForTests();
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_SENTRY_DSN;
});

describe("without a DSN (the default build)", () => {
  it("never loads the SDK and never calls init", () => {
    expect(initObservability({ ...ENV, dsn: undefined }, load)).toBe(false);
    expect(initObservability({ ...ENV, dsn: "" }, load)).toBe(false);

    expect(load).not.toHaveBeenCalled();
    expect(init).not.toHaveBeenCalled();
  });

  it("reads the DSN from EXPO_PUBLIC_SENTRY_DSN — absent there, the app's own call is a no-op", () => {
    expect(readObservabilityEnv()).toEqual({
      dsn: undefined,
      appEnv: undefined,
      isDev: false,
      version: "0.1.0",
      build: 7,
    });
    // The root layout's call, verbatim. Had it reached the real loader, the
    // SDK itself would have been required (vi.mock does not reach `require`).
    expect(initObservability(readObservabilityEnv())).toBe(false);
    expect(init).not.toHaveBeenCalled();

    process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
    expect(readObservabilityEnv().dsn).toBe(DSN);
  });

  it("a caught crash reports nothing", () => {
    initObservability({ ...ENV, dsn: undefined }, load);
    captureCrash(new Error("boom"));
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("with a DSN", () => {
  it("pins the privacy settings: no PII, no logs, no screen, no tracing", () => {
    const options = started();

    expect(options.dsn).toBe(DSN);
    // Still live in @sentry/react-native 8 (JavaScript SDK 10): it gates IP
    // inference, deep-link and route parameters — unlike the web's SDK 11.
    expect(options.sendDefaultPii).toBe(false);
    expect(options.enableLogs).toBe(false);
    // SDK 10's core drops sendDefaultPii once a dataCollection is present.
    expect(options).not.toHaveProperty("dataCollection");
    expect(options.attachScreenshot).toBe(false);
    expect(options.attachViewHierarchy).toBe(false);
    // Tracing off: no sample rate at all — the SDK counts ANY number, `0`
    // included, as tracing on and loads its integrations; absent does not.
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("tracesSampler");
    expect(options.enableAutoPerformanceTracing).toBe(false);
    // No release-health sessions: they would send the installation id from
    // every launch of every device, not only from the ones that crash.
    expect(options.enableAutoSessionTracking).toBe(false);
    // Session Replay is configured by its sample rates; there are none.
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
    // Native network breadcrumbs carry the query string; native crash
    // reports never pass beforeSend, so they are switched off at the source.
    expect(options.enableNetworkBreadcrumbs).toBe(false);
  });

  it("filters Replay, feedback, screenshots and the view hierarchy out of the defaults", () => {
    const options = started();
    const defaults = [
      "ReactNativeErrorHandlers",
      "MobileReplay",
      // @sentry/react-native 8's replay network capture and shake-to-report
      // feedback form (#390) — never enabled by us, filtered if a default ever is.
      "MobileReplayNetworkDetails",
      "MobileReplayNetworkBodies",
      "ShakeToReport",
      "Breadcrumbs",
      "MobileFeedback",
      "AutoInjectMobileFeedback",
      "Screenshot",
      "ViewHierarchy",
      "DeviceContext",
    ].map((name) => ({ name }));

    const kept = (options.integrations as (d: { name: string }[]) => { name: string }[])(defaults);

    expect(kept.map((i) => i.name)).toEqual([
      "ReactNativeErrorHandlers",
      "Breadcrumbs",
      "DeviceContext",
    ]);
  });

  it("names the stage and the build: production by default, the marker when set", () => {
    const options = started();
    expect(options.environment).toBe("production");
    expect(options.release).toBe("matio-app@0.1.0+7");
    expect(options.dist).toBe("7");

    expect(resolveAppEnvironment({ appEnv: "staging", isDev: false })).toBe("staging");
    expect(resolveAppEnvironment({ appEnv: "", isDev: true })).toBe("development");
    expect(resolveAppRelease({ version: undefined, build: 7 })).toBeUndefined();
  });

  it("starts once — a second call (a fast refresh) does not init again", () => {
    started();
    expect(initObservability(ENV, load)).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it("reports a caught crash to Sentry", () => {
    started();
    const error = new Error("boom");
    captureCrash(error);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
  });
});

describe("the scrubbers, on an event shaped the way the React Native SDK builds one", () => {
  const ADDRESS = "ana@example.com";

  function rnEvent() {
    return {
      level: "error",
      platform: "javascript",
      exception: {
        values: [
          {
            type: "TypeError",
            value: `Cannot read property 'episodes' of undefined (viewer ${ADDRESS})`,
            mechanism: { type: "onerror", handled: false },
            // RN frames: the bundle, rewritten to app:/// — not a .js file,
            // so the web's injected-script rule must not drop it.
            stacktrace: {
              frames: [{ filename: "app:///main.jsbundle", lineno: 1, colno: 4242 }],
            },
          },
        ],
      },
      breadcrumbs: [
        { category: "console", message: `signing in ${ADDRESS}` },
        {
          category: "xhr",
          type: "http",
          data: {
            url: `https://matio.tv/api/v1/shows/fallen?email=${ADDRESS}`,
            method: "GET",
            status_code: 500,
          },
        },
        // sentry-cocoa's own, merged in through the native device context.
        {
          category: "http",
          type: "http",
          data: {
            url: "https://image.mux.com/pb/thumbnail.webp",
            "http.query": "token=dummy-jwt",
            method: "GET",
          },
        },
      ],
      // Whatever lands on the user, only the id may leave.
      user: { id: "installation-1", email: ADDRESS },
      contexts: { os: { name: "iOS" } },
    };
  }

  it("strips the address and every query string, keeps the stack and the id", () => {
    const options = started();
    const event = rnEvent();

    // Synchronous by construction (lib/observability.ts), never a promise.
    const sent = options.beforeSend!(event as never, {
      originalException: new Error(),
    } as never) as (SentryEventLike & { exception?: { values?: RnExceptionValue[] } }) | null;

    expect(sent).not.toBeNull();
    const json = JSON.stringify(sent);
    expect(json).not.toContain(ADDRESS);
    expect(json).not.toContain("?email");
    expect(json).not.toContain("dummy-jwt");
    expect(sent!.user).toEqual({ id: "installation-1" });
    expect(sent!.breadcrumbs?.map((b) => b.category)).toEqual(["xhr", "http"]);
    expect(sent!.breadcrumbs?.[0]?.data?.url).toBe("https://matio.tv/api/v1/shows/fallen");
    expect(sent!.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe(
      "app:///main.jsbundle",
    );
  });

  it("drops a console breadcrumb at capture time", () => {
    const options = started();
    expect(
      options.beforeBreadcrumb!({ category: "console", message: `hi ${ADDRESS}` }, undefined),
    ).toBeNull();
  });
});
