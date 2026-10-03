// The web's Sentry privacy contract, re-exported for the app (#317): the
// scrubbers the Node, edge and browser configs spread in are the ones the
// app's `beforeSend` / `beforeBreadcrumb` run, so "the site scrubs but the app
// does not" cannot happen by editing one file. The switches around them differ
// by SDK (the app's still reads `sendDefaultPii`, the web's no longer does —
// #390), hence `sentryAppPrivacyOptions`.
//
// lib/observability.ts is safe here for the same reason as ./design.ts: zero
// imports, no `server-only`, no `process.env` reads — the environment arrives
// as an argument.
export {
  redactEmails,
  sentryAppPrivacyOptions,
  type SentryBreadcrumbLike,
  type SentryEventLike,
} from "../../../lib/observability";
