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

export interface SentryStackFrameLike {
  filename?: string;
  lineno?: number;
  colno?: number;
}

export interface SentryExceptionValueLike {
  type?: string;
  value?: string;
  mechanism?: { handled?: boolean };
  stacktrace?: { frames?: SentryStackFrameLike[] };
}

/** What `beforeSend` gets next to the event — the thrown value, as thrown. */
export interface SentryHintLike {
  originalException?: unknown;
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

/**
 * Hosts whose failed fetch is a viewer's blocker at work, not a fault of ours.
 * ONE entry on purpose — `litix.io` is where Mux Data beacons go, an ad blocker
 * or a DNS filter cuts them, and mux-embed leaves the rejection unhandled
 * (#265). This is not a general noise filter: a host earns a place here only
 * with its own issue behind it.
 */
const BLOCKED_BEACON_HOSTS = ["litix.io"];

/**
 * The three browser spellings of "the network refused" (Chromium, Safari,
 * Firefox) followed by ` (host)`. The host is NOT ours and not a scrubber's: the
 * SDK's own fetch instrumentation rewrites `error.message` to `<text> (<host>)`
 * for exactly these three texts on a `TypeError` (`enhanceFetchErrorMessages`,
 * default `always`), so it arrives in `exception.values[].value` — the only
 * field that names the request that FAILED. Breadcrumbs are deliberately not
 * consulted: a beacon to litix sits in the trail of every playback session, so
 * it would also be found behind a genuine `Failed to fetch (matio.tv)`.
 */
const FETCH_FAILURE_WITH_HOST =
  /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?) \(([^()\s]+)\)$/;

/**
 * True for the one event family we drop instead of report: an UNHANDLED
 * `TypeError` network failure whose host is a blocked-beacon host.
 *
 * Every condition is load-bearing, because the same text for `matio.tv` is a
 * real incident (#259 looked exactly like this): the thrown error itself — the
 * LAST value, causes come before it — must be a `TypeError`, nobody caught it
 * (`handled === false`; a handled one is a report someone asked for), and the
 * host must be the beacon's. Should the SDK stop appending the host, this
 * stops matching and the events simply come through again — it fails open.
 */
export function isBlockedBeaconNoise(event: SentryEventLike): boolean {
  const values = event.exception?.values;
  const thrown = values?.[values.length - 1];
  if (thrown?.type !== "TypeError" || thrown.mechanism?.handled !== false) {
    return false;
  }
  const host = FETCH_FAILURE_WITH_HOST.exec(thrown.value ?? "")?.[1]?.toLowerCase();
  if (!host) return false;
  return BLOCKED_BEACON_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

/** The schemes a browser extension's own scripts run under. */
const EXTENSION_SCHEMES = [
  "chrome-extension",
  "moz-extension",
  "safari-web-extension",
  "safari-extension",
];

const APP_PREFIX = "app:///";

/** Same-origin paths our own JavaScript is served from (see `isStrayFrame`). */
const OWN_SCRIPT_DIRS = ["_next/", "ingest/"];

/** `scheme` and `host` at the head of an absolute URL. */
const URL_HEAD = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i;

function isExtensionScheme(scheme: string | undefined): boolean {
  return scheme !== undefined && EXTENSION_SCHEMES.includes(scheme.toLowerCase());
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where an `app:///` frame really came from. The frame cannot say: in the
 * browser the SDK's frame normalisation (`@sentry/nextjs`,
 * `clientNormalizationIntegration`) writes `app://` over the origin of EVERY
 * URL it can parse, and it runs before `beforeSend` — so our own origin, a
 * vendor's CDN (`clerk.matio.tv`, `js.stripe.com`) and a Chromium extension
 * (whose origin Chromium reports as `chrome-extension://<id>`) all arrive as
 * the same `app:///<path>`. The thrown error's own `stack` is the one place no
 * integration rewrites, so this frame's `path:line:column` is looked up there,
 * and every place it appears must be the page's host or an extension. Absent,
 * on another host, or no line and column to look for: not proven.
 */
function appFrameIsStray(
  path: string,
  frame: SentryStackFrameLike,
  rawStack: string | undefined,
  pageHost: string | undefined,
): boolean {
  if (!rawStack || frame.lineno === undefined || frame.colno === undefined) {
    return false;
  }
  // The left boundary keeps the scan linear: without it a long run of scheme
  // characters in the message is retried from every offset. Not a lookbehind —
  // Safari < 16.4 throws on one when the RegExp is compiled.
  const location = new RegExp(
    `(?:^|[^a-z0-9+.-])([a-z][a-z0-9+.-]*)://([^/\\s()@]*)/${escapeForRegExp(path)}:${frame.lineno}:${frame.colno}(?!\\d)`,
    "gi",
  );
  let seen = false;
  for (const [, scheme, host] of rawStack.matchAll(location)) {
    const ours = /^https?$/i.test(scheme) && host.toLowerCase() === pageHost;
    if (!ours && !isExtensionScheme(scheme)) return false;
    seen = true;
  }
  return seen;
}

/**
 * A frame proven to belong to a script the page never served: an extension's
 * (Firefox and Safari report its origin as `null`, so the scheme survives into
 * the frame), or a `.js` file on our own origin outside the two places we serve
 * JavaScript from: `/_next/` (the app — `public/` has no `.js`) and `/ingest/`
 * (PostHog, proxied to its asset host by `next.config.ts`: lazy bundles at
 * `/ingest/static/<version>/<name>.js` — session recording, surveys, exception
 * autocapture, web vitals — and the remote config at
 * `/ingest/array/<token>/config.js`). An inline script's frame names the page
 * URL, which does not end in `.js`.
 */
function isStrayFrame(
  frame: SentryStackFrameLike,
  rawStack: string | undefined,
  pageHost: string | undefined,
): boolean {
  const filename = frame.filename;
  if (!filename) return false;
  if (!filename.startsWith(APP_PREFIX)) {
    return isExtensionScheme(URL_HEAD.exec(filename)?.[1]);
  }
  const path = filename.slice(APP_PREFIX.length);
  if (!path.endsWith(".js") || OWN_SCRIPT_DIRS.some((dir) => path.startsWith(dir))) {
    return false;
  }
  return appFrameIsStray(path, frame, rawStack, pageHost);
}

/**
 * True for an UNHANDLED error whose every stack frame is a script someone else
 * put into the page — an extension, a bot's injected helper (#271: two page
 * loads threw 700 `reading 'M_ID'` from `app:///executors/200.js`, a file
 * matio.tv has never served — a seventh of the plan's 5,000-error quota).
 *
 * Every frame must be proven stray, so the rule fails open: one frame under
 * `_next/`, one frame with no filename, `<anonymous>`, a vendor's host, or no
 * raw stack to confirm an `app:///` origin — and the event is reported. A
 * handled error is a report someone asked for, as in `isBlockedBeaconNoise`.
 * Server frames never match: Node and edge rewrite the dist dir to
 * `app:///_next/…`, and a server stack names file paths, not `scheme://host`.
 */
export function isInjectedScriptNoise(
  event: SentryEventLike,
  hint?: SentryHintLike,
): boolean {
  const values = event.exception?.values;
  const thrown = values?.[values.length - 1];
  if (thrown?.mechanism?.handled !== false) return false;
  const frames = thrown.stacktrace?.frames;
  if (!frames || frames.length === 0) return false;
  const stack = (hint?.originalException as { stack?: unknown } | null | undefined)
    ?.stack;
  const rawStack = typeof stack === "string" ? stack : undefined;
  const pageHost = URL_HEAD.exec(event.request?.url ?? "")?.[2]?.toLowerCase();
  return frames.every((frame) => isStrayFrame(frame, rawStack, pageHost));
}

export interface SentryPrivacyOptions {
  sendDefaultPii: false;
  enableLogs: false;
  beforeSend: <E extends SentryEventLike>(
    event: E,
    hint?: SentryHintLike,
  ) => E | null;
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
    beforeSend: (event, hint) => {
      if (isBlockedBeaconNoise(event) || isInjectedScriptNoise(event, hint)) {
        return null;
      }
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

/**
 * The loggable shape of a failed vendor call: class, vendor error code and HTTP
 * status — never the message. Vendors quote what was sent (Stripe echoes request
 * parameters, fetch errors carry URLs), so `err.message` in a log is how an
 * address leaks. Moved here from the Clerk erasure route once the checkout paths
 * needed the same answer (#214); both are covered by lib/log-audit.test.ts.
 */
export function describeError(err: unknown): {
  name: string;
  code?: string;
  statusCode?: number;
} {
  const e = err as { name?: unknown; code?: unknown; statusCode?: unknown };
  return {
    name: typeof e?.name === "string" ? e.name : "unknown",
    code: typeof e?.code === "string" ? e.code : undefined,
    statusCode: typeof e?.statusCode === "number" ? e.statusCode : undefined,
  };
}
