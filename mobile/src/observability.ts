import type * as SentryModule from "@sentry/react-native";
import type { ReactNativeOptions } from "@sentry/react-native";
import { sentryPrivacyOptions } from "@/shared/observability";

// The app's error tracker (#317): the same Sentry project as the web (EU
// region), with the web's privacy contract — and, like the web, DSN-optional
// by construction. `EXPO_PUBLIC_SENTRY_DSN` unset = no `Sentry.init`, and the
// SDK's JavaScript is never even evaluated: it is `require`d inside the one
// branch that has a DSN, so a build without one runs none of it (the native
// half is linked into the binary either way, and idles until JS starts it).
//
// Deliberately NOT here, each for the reason the web leaves it out:
//   - Session Replay and the feedback widget — the replay records the viewer's
//     screen, the widget asks for a name and an address. Never configured,
//     and filtered out of the default integrations should a future SDK add
//     them (`EXCLUDED_INTEGRATIONS`);
//   - screenshots and the view hierarchy on an error — the screen again;
//   - `Sentry.wrap` on the root component — it wraps the app in a touch
//     boundary (every tap becomes a breadcrumb naming the component and its
//     label), a profiler, and the feedback widget's provider; it would also
//     force a static import of the SDK into the DSN-less build. expo-router's
//     boundaries (#308) catch render crashes, and `captureCrash` reports them;
//   - tracing. The web samples 10% of traces to answer "which navigation was
//     this"; the app's errors carry their breadcrumb trail
//     instead, and performance tracing would add app-start, frame, stall and
//     fetch instrumentation — work on every launch and spans carrying route
//     names and request URLs — for a question #317 does not ask. Off: no
//     `tracesSampleRate`, and the native side's automatic performance
//     measurement switched off with it.

type SentrySdk = Pick<typeof SentryModule, "init" | "captureException">;

/** What the tracker starts with — read by ./observability-env.ts. */
export interface ObservabilityEnv {
  /** `EXPO_PUBLIC_SENTRY_DSN` — set in EAS env (production), nowhere else. */
  dsn: string | undefined;
  /** `EXPO_PUBLIC_APP_ENV` — the stage marker, the web's `APP_ENV` twin. */
  appEnv: string | undefined;
  /** A Metro development bundle (`__DEV__`). */
  isDev: boolean;
  /** The app's version, `expo.version` — what Settings shows. */
  version: string | undefined;
  /** The native build number EAS stamps (`APP_BUILD`). */
  build: number;
}

/**
 * Sentry's `environment`: our own marker first, then what the bundle is. A
 * store build without a marker IS production — it talks to matio.tv — while a
 * Metro bundle run with a DSN in the shell must not file its errors there.
 */
export function resolveAppEnvironment(env: Pick<ObservabilityEnv, "appEnv" | "isDev">): string {
  return env.appEnv || (env.isDev ? "development" : "production");
}

/**
 * Sentry's `release`: `matio-app@<version>+<build>`. The prefix is what tells
 * an app event from a web one in the shared project — the web's release is
 * the bare `X.Y.Z` release-please stamps, and the two version lines would
 * otherwise collide. The build number keeps two TestFlight builds of one
 * version apart. No version to read (never in a real build) = let the SDK
 * derive one from the native bundle.
 */
export function resolveAppRelease(env: Pick<ObservabilityEnv, "version" | "build">): string | undefined {
  return env.version ? `matio-app@${env.version}+${env.build}` : undefined;
}

/**
 * Integrations that record the viewer — the screen, a form with their
 * address — and that no default of ours ever enables. Named so a future SDK
 * that starts adding one by default still cannot ship it.
 */
const EXCLUDED_INTEGRATIONS = new Set([
  "MobileReplay",
  "Replay",
  "MobileFeedback",
  "AutoInjectMobileFeedback",
  "AutoInjectMobileFeedbackButton",
  "AutoInjectMobileScreenshotButton",
  "Screenshot",
  "ViewHierarchy",
]);

/**
 * Read by sentry-cocoa from the options dictionary the RN SDK hands to native
 * (it passes everything but the callbacks), though not in the SDK's TypeScript
 * surface. A NATIVE crash is reported by the native SDK and never passes the
 * JavaScript `beforeSend` below, so what native records on its own must be
 * clean at the source: its network breadcrumbs carry each request's query
 * string (a signed thumbnail URL's `?token=`). The app's own requests are
 * still in the trail — as the JavaScript XHR breadcrumbs, which are scrubbed
 * before they are synced to native.
 */
const NATIVE_ONLY_OPTIONS = { enableNetworkBreadcrumbs: false } as const;

/** Everything `Sentry.init` gets — pure, so the contract is testable. */
export function buildSentryOptions(
  env: ObservabilityEnv & { dsn: string },
): ReactNativeOptions & typeof NATIVE_ONLY_OPTIONS {
  return {
    dsn: env.dsn,
    environment: resolveAppEnvironment(env),
    release: resolveAppRelease(env),
    dist: String(env.build),
    // sendDefaultPii: false, enableLogs: false, and the scrubbing
    // beforeSend / beforeSendTransaction / beforeBreadcrumb.
    ...sentryPrivacyOptions(),
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableAutoPerformanceTracing: false,
    // No release-health sessions. On by default natively: a session envelope,
    // keyed on the SDK's persistent installation id, on every cold start and
    // every return to the foreground — from every device, crash or no crash.
    // #317 is crash and error reporting; those are untouched by this.
    enableAutoSessionTracking: false,
    integrations: (defaults) =>
      defaults.filter((integration) => !EXCLUDED_INTEGRATIONS.has(integration.name)),
    ...NATIVE_ONLY_OPTIONS,
  };
}

let sdk: SentrySdk | null = null;

// A `require` inside a function, not an `import`: Metro evaluates the module
// only when this runs, i.e. only with a DSN (see the top of the file).
function loadSentrySdk(): SentrySdk {
  return require("@sentry/react-native") as SentrySdk;
}

/**
 * Start the tracker — once, from the root layout, before the first render.
 * Returns whether it started. `load` is the seam the tests replace; the app
 * never passes it.
 */
export function initObservability(
  env: ObservabilityEnv,
  load: () => SentrySdk = loadSentrySdk,
): boolean {
  if (sdk) return true;
  const dsn = env.dsn;
  if (!dsn) return false;
  const loaded = load();
  loaded.init(buildSentryOptions({ ...env, dsn }));
  sdk = loaded;
  return true;
}

/**
 * Report a render crash a route's error boundary caught (#308) — the one
 * caller is `CrashScreen`. A no-op without a DSN. The error goes to Sentry
 * through `beforeSend` above, and nowhere else: not to the console, whose
 * output is exactly the channel the privacy rule keeps user text out of.
 */
export function captureCrash(error: unknown): void {
  sdk?.captureException(error);
}

/** Tests only: forget the started SDK. */
export function resetObservabilityForTests(): void {
  sdk = null;
}
