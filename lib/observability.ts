// Everything the error tracker and the health endpoints have to agree on,
// kept PURE so it can be tested without a Sentry client, a request or a build.
// `sentry.server.config.ts` / `sentry.edge.config.ts` / `sentry-client-init.ts`
// are three files that must scrub identically — so the scrubbing lives here,
// once, and they spread it in.
//
// Universal on purpose (no `server-only`): the browser SDK gets the same
// privacy contract as the server one. Nothing here reads `process.env` itself —
// the environment arrives as an argument, so a test states what it is testing.

/** An env var that exists but is EMPTY is absent — same rule as /api/healthz. */
function present(value: string | undefined): string | null {
  return value ? value : null;
}

/**
 * Anything shaped like an environment. Deliberately a bare record rather than a
 * named-key type: `process.env` (Node's `ProcessEnv`) declares nothing but an
 * index signature, and a type listing only optional keys would be rejected as a
 * "weak type" at every call site that passes it.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * WHICH STAGE this is, from `APP_ENV` then `VERCEL_ENV`. Shared by
 * `/api/healthz` and by Sentry's `environment`, so an event and a health check
 * can never disagree about where they came from.
 *
 * `APP_ENV` wins because Vercel labels the production branch of EVERY project
 * `production` — staging is its own project, so without our own marker the
 * bench's events would land in the production environment.
 */
export function resolveStage(env: EnvLike): string {
  return present(env.APP_ENV) ?? present(env.VERCEL_ENV) ?? "development";
}

/**
 * Sentry's `release`, from `APP_VERSION` — the same version `/api/healthz`
 * reports and release-please stamps on the tag, so an event points at a release
 * instead of at "some deploy in the last month". Absent = let Sentry decide.
 */
export function resolveRelease(env: EnvLike): string | undefined {
  return present(env.APP_VERSION) ?? undefined;
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

// Structural stand-ins for the Sentry payload types. Declared here rather than
// imported so this module stays dependency-free (and testable with plain
// objects); Sentry's own `ErrorEvent` / `TransactionEvent` / `Breadcrumb`
// satisfy them structurally, which is what makes `sentryPrivacyOptions()`
// droppable straight into `Sentry.init`.

export interface SentryRequestLike {
  url?: string;
  query_string?: unknown;
  cookies?: unknown;
  headers?: Record<string, string>;
  data?: unknown;
}

export interface SentryBreadcrumbLike {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface SentrySpanLike {
  data?: Record<string, unknown>;
}

export interface SentryExceptionValueLike {
  value?: string;
}

export interface SentryEventLike {
  message?: string;
  transaction?: string;
  request?: SentryRequestLike;
  breadcrumbs?: SentryBreadcrumbLike[];
  spans?: SentrySpanLike[];
  user?: { id?: string | number };
  exception?: { values?: SentryExceptionValueLike[] };
}

/**
 * Request headers that survive. An ALLOWLIST, not a denylist: a denylist is one
 * new vendor header away from leaking, and the only headers worth having in an
 * incident are the ones below. `cookie` and `authorization` are not among them
 * by construction.
 */
const ALLOWED_REQUEST_HEADERS = new Set([
  "content-type",
  "content-length",
  "user-agent",
]);

/**
 * Keys inside a breadcrumb's / span's `data` bag whose value is a URL. These are
 * where the SDK records fetch targets and route transitions — i.e. the second
 * place (after `request.url`) a query string can reach the tracker.
 */
const URL_DATA_KEYS = ["url", "http.url", "to", "from"];

// Conservative: local part, @, dotted host. Deliberately not RFC-complete —
// this is a net under the "no user text in errors" rule, not a validator.
const EMAIL_PATTERN = /[^\s"'<>@,;:]+@[^\s"'<>@,;:]+\.[a-z]{2,}/gi;

const EMAIL_PLACEHOLDER = "[redacted-email]";

/**
 * Strip the query string, the fragment AND any `user:password@` credentials
 * from a URL. Query strings in this project carry `?token=`, `?session_id=`,
 * `?fbclid=` and reminder-unsubscribe HMACs; a credential-bearing URL is what a
 * database connection string looks like when it lands in a log line.
 *
 * Deliberately string surgery rather than `new URL()`: half the URLs Sentry
 * reports are relative paths, which `new URL()` refuses outright.
 */
export function scrubUrl(value: string): string {
  const cut = value.search(/[?#]/);
  const withoutQuery = cut === -1 ? value : value.slice(0, cut);
  return withoutQuery.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

/** Replace anything shaped like an email address. */
export function redactEmails(value: string): string {
  return value.replace(EMAIL_PATTERN, EMAIL_PLACEHOLDER);
}

function scrubDataUrls(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of URL_DATA_KEYS) {
    const value = data[key];
    if (typeof value === "string") data[key] = scrubUrl(value);
  }
}

function scrubRequest(request: SentryRequestLike): void {
  if (typeof request.url === "string") request.url = scrubUrl(request.url);
  // The body of a POST is form fields and server-action arguments: emails from
  // the reminder capture form, admin form values, watch positions. None of it
  // belongs in an error report.
  delete request.query_string;
  delete request.cookies;
  delete request.data;
  if (request.headers) {
    const kept: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (ALLOWED_REQUEST_HEADERS.has(name.toLowerCase())) kept[name] = value;
    }
    request.headers = kept;
  }
}

/**
 * One breadcrumb, or `null` to drop it.
 *
 * Console breadcrumbs are dropped WHOLESALE. They are the arguments of every
 * `console.*` call the app makes, which is the one channel where a stray
 * `console.error(err)` over an object holding user data would end up in the
 * tracker verbatim — precisely the leak the privacy rule exists to prevent.
 */
export function scrubSentryBreadcrumb(
  breadcrumb: SentryBreadcrumbLike,
): SentryBreadcrumbLike | null {
  if (breadcrumb.category === "console") return null;
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactEmails(scrubUrl(breadcrumb.message));
  }
  scrubDataUrls(breadcrumb.data);
  return breadcrumb;
}

/**
 * Scrub an event in place — errors and transactions alike (both carry
 * `request`, both can carry URLs in span data).
 *
 * `contexts` is deliberately NOT walked: the HTTP data that matters is on
 * `request` and on the spans, and a blind recursive walk over an arbitrary
 * context bag is the kind of clever code that mangles stack frames.
 */
export function scrubSentryEvent(event: SentryEventLike): void {
  if (event.request) scrubRequest(event.request);
  if (typeof event.transaction === "string") {
    event.transaction = scrubUrl(event.transaction);
  }
  if (typeof event.message === "string") {
    event.message = redactEmails(event.message);
  }
  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === "string") value.value = redactEmails(value.value);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubSentryBreadcrumb)
      .filter((crumb): crumb is SentryBreadcrumbLike => crumb !== null);
  }
  for (const span of event.spans ?? []) scrubDataUrls(span.data);
  // Whatever else was attached to the user, only the id survives. Nothing in
  // the app calls `Sentry.setUser`, and this is what keeps that true.
  if (event.user) event.user = { id: event.user.id };
}

export interface SentryPrivacyOptions {
  sendDefaultPii: false;
  enableLogs: false;
  beforeSend: <E extends SentryEventLike>(event: E) => E;
  beforeSendTransaction: <E extends SentryEventLike>(event: E) => E;
  beforeBreadcrumb: (
    breadcrumb: SentryBreadcrumbLike,
  ) => SentryBreadcrumbLike | null;
}

/**
 * The privacy half of `Sentry.init`, as one value the three runtime configs
 * spread in — so "the server scrubs but the browser does not" cannot happen by
 * editing one file, and so the contract itself is unit-testable.
 *
 * `sendDefaultPii: false` keeps the SDK from attaching IPs, cookies and request
 * bodies at the source; the `beforeSend*` hooks are the belt to that braces,
 * because integrations and future SDK versions add fields on their own.
 * `enableLogs: false` keeps the SDK's log-forwarding channel shut — our logs
 * carry ids and statuses, but they are not written for an external service.
 */
export function sentryPrivacyOptions(): SentryPrivacyOptions {
  return {
    sendDefaultPii: false,
    enableLogs: false,
    beforeSend: (event) => {
      scrubSentryEvent(event);
      return event;
    },
    beforeSendTransaction: (event) => {
      scrubSentryEvent(event);
      return event;
    },
    beforeBreadcrumb: (breadcrumb) => scrubSentryBreadcrumb(breadcrumb),
  };
}
