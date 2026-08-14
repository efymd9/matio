// Sentry, Node runtime (route handlers, server components, server actions,
// webhooks). Loaded by `instrumentation.ts` and by nothing else.
//
// DSN-OPTIONAL: with `NEXT_PUBLIC_SENTRY_DSN` unset there is no `init` call at
// all — no integrations, no instrumentation, no beacons. Same degradation
// pattern as `RESEND_API_KEY` (email off, capture still works), so this code
// could land before the Sentry account existed.
//
// NEXT_PUBLIC_* is INLINED AT BUILD TIME, on the server too. Setting the DSN in
// Vercel does nothing until the next deploy — the same bind-at-deploy trap as
// `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. One variable for all three runtimes on
// purpose: a server-only twin would be one more thing to forget.
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
    // Modest on purpose: traces are the expensive half of the free plan's
    // quota, and one in ten requests is plenty to see a slow route.
    tracesSampleRate: 0.1,
    // Frame-local variables would ship the *contents* of every variable in
    // scope at the throw — request bodies, email addresses, tokens. Off by
    // default in the SDK; stated here so nobody turns it on "for debugging".
    includeLocalVariables: false,
    ...sentryPrivacyOptions(),
  });
}
