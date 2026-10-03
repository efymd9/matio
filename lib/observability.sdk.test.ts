import { createRequire } from "node:module";
import path from "node:path";

import * as Sentry from "@sentry/nextjs";
import { afterEach, describe, expect, it } from "vitest";

import { sentryPrivacyOptions } from "./observability";

// The privacy contract against the REAL @sentry/nextjs, not a mock (#390).
// lib/observability.test.ts proves the scrubbers on hand-built events and
// lib/sentry-init.test.ts that the configs pass them to `init` — neither can
// tell whether the SDK still READS the options. SDK 11 is why that matters: it
// removed `sendDefaultPii` without a type error at our call sites (the options
// are spread in, so an unknown key is not an excess property) and turned every
// data category on by default, and it streams spans, where
// `beforeSendTransaction` never runs. Here the server SDK's own client takes
// `sentryPrivacyOptions()` and an envelope is read off a fake transport; the
// browser client is asked the one thing only it decides (`infer_ip`).

const DUMMY_DSN = "https://dummy00000000000000000000000000@o0.ingest.de.sentry.io/0";

// What a request to the unsubscribe link carries — every value one that must
// not reach the tracker. `e` is the address in base64url, as in the real link.
const ADDRESS = "viewer@example.invalid";
const E = Buffer.from(ADDRESS).toString("base64url");
const URL_WITH_QUERY = `https://matio.tv/unsubscribe?e=${E}&t=dummy-hmac`;
const COOKIE = "__session=dummy-session-cookie";
const BEARER = "Bearer dummy-bearer-token";
const IP = "203.0.113.7";
const BODY = JSON.stringify({ email: ADDRESS });
const SECRETS = [ADDRESS, E, "dummy-hmac", "dummy-session-cookie", "dummy-bearer-token", IP];

let client: Sentry.NodeClient | undefined;

afterEach(async () => {
  await client?.close(0);
  client = undefined;
  Sentry.getCurrentScope().setClient(undefined);
});

/** A real server client with our options, recording each envelope it sends. */
function startClient(): { sent: string[] } {
  const sent: string[] = [];
  client = new Sentry.NodeClient({
    dsn: DUMMY_DSN,
    stackParser: Sentry.defaultStackParser,
    integrations: [Sentry.requestDataIntegration()],
    tracesSampleRate: 1,
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        sent.push(
          typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
    ...sentryPrivacyOptions(),
  });
  Sentry.getCurrentScope().setClient(client);
  client.init();
  return { sent };
}

/** The request as Next's instrumentation hands it to the SDK. */
function attachRequest(scope: Sentry.Scope): void {
  scope.setSDKProcessingMetadata({
    normalizedRequest: {
      url: URL_WITH_QUERY,
      method: "POST",
      query_string: `e=${E}&t=dummy-hmac`,
      headers: {
        cookie: COOKIE,
        authorization: BEARER,
        "x-forwarded-for": IP,
        "user-agent": "Mozilla/5.0 (dummy)",
        "content-type": "application/json",
      },
      cookies: { __session: "dummy-session-cookie" },
      data: BODY,
    },
    ipAddress: IP,
  });
}

/** The slice of the browser build this file touches. */
interface BrowserSdk {
  BrowserClient: new (options: Record<string, unknown>) => {
    getOptions(): { _metadata?: { sdk?: { settings?: { infer_ip?: string } } } };
  };
  defaultStackParser: unknown;
  createTransport: typeof Sentry.createTransport;
}

/**
 * The client a viewer's browser runs. Under node `@sentry/nextjs` resolves to
 * its server build, and the exports map lists no subpath for the client one —
 * so it is loaded by file, from the package the app itself installs.
 */
function loadBrowserSdk(): BrowserSdk {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("@sentry/nextjs/package.json"));
  return require(path.join(root, "build/cjs/index.client.js")) as BrowserSdk;
}

/** Envelope items, header line by payload line, as one array of objects. */
function items(envelope: string): Array<Record<string, unknown>> {
  return envelope
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("@sentry/nextjs with sentryPrivacyOptions()", () => {
  it("resolves every data category to off — the option names are the SDK's", () => {
    startClient();

    // A renamed or dropped key falls back to SDK 11's default, which is "on".
    expect(client!.getDataCollectionOptions()).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { allow: ["content-type", "content-length", "user-agent"] },
        response: false,
      },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
    expect(client!.getOptions().traceLifecycle).toBe("static");
  });

  it("tells Sentry never to infer the viewer's IP from a browser's connection", () => {
    // `infer_ip` rides the envelope header: Relay derives the IP from the
    // request itself, after every hook of ours has run. Only the SDK setting
    // stops it, and SDK 11 sets it from `dataCollection.userInfo`.
    const { BrowserClient, defaultStackParser, createTransport } = loadBrowserSdk();
    const base = {
      dsn: DUMMY_DSN,
      stackParser: defaultStackParser,
      integrations: [],
      transport: (options: Parameters<typeof createTransport>[0]) =>
        createTransport(options, async () => ({ statusCode: 200 })),
    };

    const ours = new BrowserClient({ ...base, ...sentryPrivacyOptions() });
    // The SDK's own default — so the assertion above it is not vacuous.
    const bare = new BrowserClient(base);

    expect(ours.getOptions()._metadata?.sdk?.settings?.infer_ip).toBe("never");
    expect(bare.getOptions()._metadata?.sdk?.settings?.infer_ip).toBe("auto");
  });

  it("sends an error with no cookie, header, IP, body, query or address in it", async () => {
    const { sent } = startClient();
    const scope = Sentry.getCurrentScope().clone();
    attachRequest(scope);

    client!.captureException(new Error(`unsubscribe failed for ${ADDRESS}`), undefined, scope);
    await client!.flush(2000);

    expect(sent).toHaveLength(1);
    for (const secret of SECRETS) expect(sent[0]).not.toContain(secret);
    const event = items(sent[0]!).find((item) => "exception" in item) as {
      request?: { url?: string; headers?: Record<string, string> };
    };
    // Not vacuous: the request did go through, minus everything above.
    expect(event.request?.url).toBe("https://matio.tv/unsubscribe");
    expect(event.request?.headers).toEqual({
      "user-agent": "Mozilla/5.0 (dummy)",
      "content-type": "application/json",
    });
  });

  it("sends a sampled trace as a transaction, through beforeSendTransaction", async () => {
    const { sent } = startClient();

    // Attributes set by hand are not filtered by dataCollection (it gates what
    // the SDK collects itself) — only our hooks stand between these and Sentry.
    Sentry.startSpan(
      {
        name: "POST /unsubscribe",
        forceTransaction: true,
        attributes: {
          "url.full": URL_WITH_QUERY,
          "url.query": `e=${E}&t=dummy-hmac`,
          "http.request.header.cookie": [COOKIE],
          "client.address": IP,
          "http.request.method": "POST",
        },
      },
      () => undefined,
    );
    await client!.flush(2000);

    expect(sent).toHaveLength(1);
    const [header, itemHeader, payload] = items(sent[0]!);
    expect(header).toHaveProperty("event_id");
    // A streamed trace would be a `span` item and skip beforeSendTransaction.
    expect(itemHeader).toMatchObject({ type: "transaction" });
    for (const secret of SECRETS) expect(sent[0]).not.toContain(secret);
    expect(payload).toMatchObject({
      contexts: {
        trace: {
          data: { "url.full": "https://matio.tv/unsubscribe", "http.request.method": "POST" },
        },
      },
    });
  });
});
