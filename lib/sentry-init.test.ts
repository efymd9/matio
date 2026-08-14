import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The wiring, as opposed to the scrubbers (lib/observability.test.ts). Two
// promises are made about these three files and both are load-bearing:
//
//   1. NO DSN → no `Sentry.init` anywhere. That is what let this code merge
//      before the Sentry account existed, and what keeps `pnpm build` and
//      every preview deploy free of it.
//   2. WITH a DSN → the privacy options actually reach `init`. A `beforeSend`
//      that exists in lib/ but is never passed to the SDK protects nothing.
//
// The configs live at the repository root (Next requires it), so they are
// imported through the `@/` alias from here, where the unit project looks.

const { init, captureRequestError } = vi.hoisted(() => ({
  init: vi.fn(),
  captureRequestError: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ init, captureRequestError }));

const DUMMY_DSN = "https://dummy00000000000000000000000000@o0.ingest.de.sentry.io/0";

beforeEach(() => {
  vi.resetModules();
  init.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentry.server.config", () => {
  it("does not initialise anything without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");

    await import("@/sentry.server.config");

    expect(init).not.toHaveBeenCalled();
  });

  it("initialises with the stage, the release and the privacy contract", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DUMMY_DSN);
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_VERSION", "0.3.0");

    await import("@/sentry.server.config");

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: DUMMY_DSN,
      // The bench must not report as production — the whole reason APP_ENV
      // exists (see /api/healthz).
      environment: "staging",
      release: "0.3.0",
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      enableLogs: false,
      // Frame locals would ship the contents of every variable at the throw.
      includeLocalVariables: false,
    });
    expect(typeof options.beforeSend).toBe("function");
    expect(typeof options.beforeSendTransaction).toBe("function");
    expect(typeof options.beforeBreadcrumb).toBe("function");
  });

  it("hands the SDK a beforeSend that really scrubs", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DUMMY_DSN);

    await import("@/sentry.server.config");
    const { beforeSend } = init.mock.calls[0][0];

    const event = beforeSend({
      request: {
        url: "https://matio.tv/welcome?session_id=cs_live_1",
        cookies: { __session: "dummy" },
      },
    });

    expect(event.request.url).toBe("https://matio.tv/welcome");
    expect(event.request).not.toHaveProperty("cookies");
  });
});

describe("sentry.edge.config", () => {
  it("does not initialise anything without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");

    await import("@/sentry.edge.config");

    expect(init).not.toHaveBeenCalled();
  });

  it("carries the same privacy contract as the server config", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DUMMY_DSN);
    vi.stubEnv("APP_ENV", "");
    vi.stubEnv("VERCEL_ENV", "production");

    await import("@/sentry.edge.config");

    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toMatchObject({
      environment: "production",
      sendDefaultPii: false,
      enableLogs: false,
    });
  });
});

describe("instrumentation", () => {
  it("loads no runtime config at all without a DSN", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    vi.stubEnv("NEXT_RUNTIME", "nodejs");

    const { register } = await import("@/instrumentation");
    await register();

    expect(init).not.toHaveBeenCalled();
  });

  it("loads the Node config on the Node runtime and nothing else", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DUMMY_DSN);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("APP_ENV", "staging");

    const { register } = await import("@/instrumentation");
    await register();

    // One init, and it is the Node one: only that config sets the Node-only
    // `includeLocalVariables`.
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).toHaveProperty("includeLocalVariables", false);
  });

  it("loads the edge config on the edge runtime", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DUMMY_DSN);
    vi.stubEnv("NEXT_RUNTIME", "edge");

    const { register } = await import("@/instrumentation");
    await register();

    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0][0]).not.toHaveProperty("includeLocalVariables");
  });

  it("exports the onRequestError hook", async () => {
    // Without this export, every error thrown inside a route handler, server
    // component or server action is swallowed by Next and never reported.
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DUMMY_DSN);

    const instrumentation = await import("@/instrumentation");

    expect(instrumentation.onRequestError).toBe(captureRequestError);
  });
});
