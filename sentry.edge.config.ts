// Sentry, Edge runtime. Small but not optional: `proxy.ts` (auth gating, the
// staging lock, marketing + visitor cookies) and the OG image routes run here,
// and an exception in the middleware is a 500 on EVERY request — the loudest
// failure this project has (incident #46).
//
// Same DSN-optional contract and the same privacy options as the Node config;
// `includeLocalVariables` is absent because it is a Node-only option.
import * as Sentry from "@sentry/nextjs";

import {
  resolveRelease,
  resolveStage,
  sentryPrivacyOptions,
} from "@/lib/observability";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: resolveStage(process.env),
    release: resolveRelease(process.env),
    tracesSampleRate: 0.1,
    ...sentryPrivacyOptions(),
  });
}
