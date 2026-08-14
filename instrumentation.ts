// Next's server-side instrumentation hook. Runs once per runtime, before the
// app serves anything.
//
// Both imports are dynamic and both are behind the DSN check: with Sentry off,
// neither runtime config is ever evaluated.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// WITHOUT THIS EXPORT, errors thrown inside App Router route handlers, server
// components and server actions never reach Sentry — Next catches them itself
// and hands them to this hook instead of letting them propagate. It is a no-op
// while the SDK is uninitialised, so it needs no DSN guard of its own.
export const onRequestError = Sentry.captureRequestError;
