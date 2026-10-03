// Sentry, browser. Imported lazily by `instrumentation-client.ts` and only when
// a DSN exists — see the reasoning there.
//
// NOT named `sentry.client.config.ts`: that filename is the SDK's legacy
// auto-detected entry point, and the build plugin would inject it into the
// client bundle statically, defeating the lazy load.
//
// Deliberately WITHOUT `replayIntegration` and `feedbackIntegration`, which the
// setup wizard adds by default. Session Replay records the DOM — that is the
// viewer's screen, their email in a form field, their watch history — and a
// feedback widget collects a name and an email address. Both are exactly the
// data this project's privacy rule says never reaches the error tracker.
import * as Sentry from "@sentry/nextjs";

import {
  resolveRelease,
  resolveStage,
  sentryPrivacyOptions,
} from "@/lib/observability";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Only NEXT_PUBLIC_* and `next.config.ts`'s `env` block survive into the
  // browser bundle, so the stage arrives through its own public twin.
  // `NEXT_PUBLIC_VERCEL_ENV` is Vercel's own (and, like `VERCEL_ENV`, says
  // `production` for the staging project too) — hence `NEXT_PUBLIC_APP_ENV`
  // first, mirroring the `APP_ENV` marker the server uses.
  environment: resolveStage({
    APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  }),
  // Next inlines env vars into the client bundle ONLY on direct property
  // access — `process.env.APP_VERSION` as a literal expression. Passing the
  // whole `process.env` object hands the browser an empty shim and the
  // release tag silently vanishes (caught live on staging, issue #81).
  release: resolveRelease({ APP_VERSION: process.env.APP_VERSION }),
  tracesSampleRate: 0.1,
  // Replaces the default tracing integration of the same name — the SDK's own
  // Next.js one, so router instrumentation stays — with INP measurement OFF
  // (#394). An INP span is named after the touched element's selector, aria-
  // label / title / alt included, and is sent ON ITS OWN: after the pageload
  // span has ended it is its own root, and the SDK copies its name into the
  // envelope header (`trace.transaction`, dynamic sampling), which no hook can
  // reach. Trimming the span would leave that copy; not measuring INP leaves
  // nothing. Re-enable only with that header solved.
  integrations: [Sentry.browserTracingIntegration({ enableInp: false })],
  ...sentryPrivacyOptions(Sentry.withStaticSpan),
});
