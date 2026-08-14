// Next's client-side instrumentation hook — the browser half of Sentry.
//
// The SDK is pulled in DYNAMICALLY. `NEXT_PUBLIC_SENTRY_DSN` is inlined at
// build time, so with no DSN the condition below is a literal `undefined`, the
// import is dead code, and the browser SDK (tens of kilobytes) never enters the
// bundle a viewer downloads. A static import would ship it to every visitor
// whether or not it is ever used — the same reasoning that keeps the hero
// MuxPlayer behind `next/dynamic`.
//
// The cost of that choice is one chunk load before `init` runs: an error thrown
// in the first instants of a page load can be missed. Accepted — the same
// window exists for any lazily-loaded reporter, and server-side errors (the
// ones that take the site down) are captured by `instrumentation.ts` regardless.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void import("./sentry-client-init");
}

// Route transitions are what turn a browser error into "which navigation was
// this". `import()` in a TYPE position is erased at compile time, so the
// signature costs nothing at runtime.
export function onRouterTransitionStart(
  ...args: Parameters<
    typeof import("@sentry/nextjs").captureRouterTransitionStart
  >
) {
  if (!dsn) return;
  void import("@sentry/nextjs").then((Sentry) =>
    Sentry.captureRouterTransitionStart(...args),
  );
}
