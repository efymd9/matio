import { describe, expect, it } from "vitest";

import {
  isBlockedBeaconNoise,
  isInjectedScriptNoise,
  redactEmails,
  resolveRelease,
  resolveStage,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubUrl,
  sentryAppPrivacyOptions,
  sentryPrivacyOptions,
  stripQueryParams,
  type SentryEventLike,
  type SentryExceptionValueLike,
  type SentryHintLike,
  type SentryStackFrameLike,
} from "./observability";

// These are not "does the function run" tests. The scrubbers are the only thing
// standing between a viewer's session and a third-party service, so every case
// below is a leak that would otherwise be shipped: a token in a query string, a
// session cookie in a header, an email in an error message.

describe("resolveStage", () => {
  it("prefers our own APP_ENV marker over Vercel's target", () => {
    // The reason the marker exists: Vercel calls the production branch of ANY
    // project `production`, so the staging bench would report `production`.
    expect(resolveStage({ APP_ENV: "staging", VERCEL_ENV: "production" })).toBe(
      "staging",
    );
  });

  it("falls back to the Vercel target, then to development", () => {
    expect(resolveStage({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(resolveStage({})).toBe("development");
  });

  it("treats an empty marker as no marker", () => {
    // A Vercel variable can be defined blank; a blank one must not shadow.
    expect(resolveStage({ APP_ENV: "", VERCEL_ENV: "production" })).toBe(
      "production",
    );
  });
});

describe("resolveRelease", () => {
  it("reports the build version and admits when there is none", () => {
    expect(resolveRelease({ APP_VERSION: "0.3.0" })).toBe("0.3.0");
    // Undefined rather than "" — Sentry treats an empty release as a real,
    // nameless release and groups every such event together.
    expect(resolveRelease({ APP_VERSION: "" })).toBeUndefined();
    expect(resolveRelease({})).toBeUndefined();
  });
});

describe("scrubUrl", () => {
  it("drops the query string, where the secrets live", () => {
    expect(
      scrubUrl("https://matio.tv/welcome?session_id=cs_test_123&utm_source=fb"),
    ).toBe("https://matio.tv/welcome");
    expect(scrubUrl("/unsubscribe?token=abc.def")).toBe("/unsubscribe");
  });

  it("drops the fragment too", () => {
    expect(scrubUrl("https://matio.tv/about#team")).toBe("https://matio.tv/about");
  });

  it("drops credentials embedded in the authority", () => {
    // This is what a database URL looks like when it lands in a log line.
    expect(scrubUrl("postgres://user:dummy-secret@db.example/matio")).toBe(
      "postgres://db.example/matio",
    );
  });

  it("leaves a clean URL exactly as it is", () => {
    expect(scrubUrl("https://matio.tv/shows/thunder-lady")).toBe(
      "https://matio.tv/shows/thunder-lady",
    );
  });
});

describe("redactEmails", () => {
  it("replaces addresses and keeps the rest of the sentence", () => {
    expect(redactEmails("reminder for viewer@example.invalid failed")).toBe(
      "reminder for [redacted-email] failed",
    );
  });

  it("leaves text with no address untouched", () => {
    expect(redactEmails("episode 4 is not ready")).toBe("episode 4 is not ready");
  });
});

// What a failed Drizzle query puts in its message (drizzle-orm 0.45,
// errors.js: `Failed query: ${query}\nparams: ${params}`). The params are what
// the request bound — here a trial cookie / device UUID and an IP hash — and
// must never reach the tracker; the SQL is what the incident is fixed from.
const QUERY_SQL =
  'select "id", "expires_at" from "trial_sessions" where ("session_token" = $1 and "show_id" = $2)';
const QUERY_UUID = "1eaf0000-dead-4bee-8f00-00000000beef";
const QUERY_HASH = "dummy-ip-hash-5f2c9a1b";
const DRIZZLE_MESSAGE = `Failed query: ${QUERY_SQL}\nparams: ${QUERY_UUID},show_1,${QUERY_HASH}`;
const STATEMENT_ONLY = `Failed query: ${QUERY_SQL}`;

describe("stripQueryParams (#326)", () => {
  it("cuts everything from the \\nparams: Drizzle appends, and keeps the statement", () => {
    expect(stripQueryParams(DRIZZLE_MESSAGE)).toBe(STATEMENT_ONLY);
  });

  it("cuts a params list that itself spans lines", () => {
    expect(stripQueryParams(`${STATEMENT_ONLY}\nparams: a,b\nc,d`)).toBe(STATEMENT_ONLY);
  });

  it("leaves a message with no params exactly as it is", () => {
    expect(stripQueryParams("connect ECONNREFUSED 10.0.0.1:5432")).toBe(
      "connect ECONNREFUSED 10.0.0.1:5432",
    );
    // `params:` mid-line is not Drizzle's format — nothing to cut on.
    expect(stripQueryParams("bad params: x")).toBe("bad params: x");
  });
});

describe("scrubSentryBreadcrumb", () => {
  it("drops console breadcrumbs entirely", () => {
    // Console arguments are whatever the app happened to log — the one channel
    // that can carry anything at all.
    expect(
      scrubSentryBreadcrumb({
        category: "console",
        message: "user viewer@example.invalid failed to subscribe",
      }),
    ).toBeNull();
  });

  it("keeps a fetch breadcrumb but strips the URL's query string", () => {
    const crumb = scrubSentryBreadcrumb({
      category: "fetch",
      data: { url: "/api/playback-token?ep=42&token=secret", status_code: 403 },
    });

    expect(crumb?.data).toEqual({ url: "/api/playback-token", status_code: 403 });
  });

  it("cleans a breadcrumb's own message", () => {
    // Several SDK breadcrumbs put the URL in `message` rather than in `data`,
    // and a hand-written one can carry whatever the caller passed.
    const crumb = scrubSentryBreadcrumb({
      category: "xhr",
      message: "POST /unsubscribe?email=viewer@example.invalid",
    });

    expect(crumb?.message).toBe("POST /unsubscribe");
  });

  it("redacts an address left in a breadcrumb message", () => {
    const crumb = scrubSentryBreadcrumb({
      category: "sentry.event",
      message: "reminder queued for viewer@example.invalid",
    });

    expect(crumb?.message).toBe("reminder queued for [redacted-email]");
  });

  it("cuts the params Drizzle quotes after a failed statement (#326)", () => {
    const crumb = scrubSentryBreadcrumb({
      category: "sentry.event",
      message: DRIZZLE_MESSAGE,
    });

    expect(crumb?.message).toBe(STATEMENT_ONLY);
  });

  it("drops the query and fragment the SDK splits off next to a clean URL", () => {
    // sentry-cocoa's network breadcrumb (merged into an app event, #317) and
    // Node's outgoing-request breadcrumb carry the query in a key of its own.
    const crumb = scrubSentryBreadcrumb({
      category: "http",
      data: {
        url: "https://image.mux.com/abc/thumbnail.webp",
        "http.query": "token=secret&email=viewer@example.invalid",
        "http.fragment": "t=10",
        method: "GET",
        status_code: 200,
      },
    });

    expect(crumb?.data).toEqual({
      url: "https://image.mux.com/abc/thumbnail.webp",
      method: "GET",
      status_code: 200,
    });
  });

  it("strips both ends of a navigation breadcrumb", () => {
    const crumb = scrubSentryBreadcrumb({
      category: "navigation",
      data: { from: "/watch/x?ep=1", to: "/welcome?session_id=cs_live_1" },
    });

    expect(crumb?.data).toEqual({ from: "/watch/x", to: "/welcome" });
  });
});

function seededEvent(): SentryEventLike {
  return {
    transaction: "GET /welcome?session_id=cs_live_9",
    message: "checkout claim failed for viewer@example.invalid",
    request: {
      url: "https://matio.tv/welcome?session_id=cs_live_9&fbclid=xyz",
      query_string: "session_id=cs_live_9",
      cookies: { trial_session: "tok_abc", __session: "clerk_jwt" },
      headers: {
        Cookie: "trial_session=tok_abc",
        Authorization: "Bearer dummy-token",
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/json",
      },
      data: { email: "viewer@example.invalid" },
    },
    user: { id: "user_123", email: "viewer@example.invalid" } as {
      id?: string | number;
    },
    breadcrumbs: [
      { category: "console", message: "viewer@example.invalid" },
      { category: "fetch", data: { url: "/api/t?aid=abc" } },
    ],
    spans: [
      {
        data: {
          "http.url": "https://api.stripe.com/v1/x?key=sk-test-1",
          "http.query": "?key=sk-test-1",
          // Browser fetch/XHR and Node undici spans: the whole href, plus the
          // query and fragment on their own (#346).
          "url.full": "https://api.stripe.com/v1/x?key=sk-test-1#frag",
          "url.query": "?key=sk-test-1",
          "url.fragment": "#frag",
        },
      },
    ],
    exception: {
      values: [{ value: "no reminder row for viewer@example.invalid" }],
    },
  };
}

describe("scrubSentryEvent", () => {
  it("removes the query string from every URL the event carries", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    expect(event.request?.url).toBe("https://matio.tv/welcome");
    expect(event.transaction).toBe("GET /welcome");
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "/api/t" });
    expect(event.spans?.[0]?.data).toEqual({
      "http.url": "https://api.stripe.com/v1/x",
      "url.full": "https://api.stripe.com/v1/x",
    });
  });

  it("cleans the root span's attributes — Next's http.target carries the query (#346)", () => {
    // The unsubscribe link from a reminder email: `e` is the address in
    // base64url, `t` its HMAC. A sampled server transaction for that request
    // records the raw path WITH the query on its root span.
    const e = Buffer.from("viewer@example.invalid").toString("base64url");
    const event: SentryEventLike = {
      transaction: "GET /unsubscribe",
      contexts: {
        trace: {
          data: {
            "http.target": `/unsubscribe?e=${e}&t=dummy-hmac`,
            "http.url": `https://matio.tv/unsubscribe?e=${e}&t=dummy-hmac`,
            "url.full": `https://matio.tv/unsubscribe?e=${e}&t=dummy-hmac`,
            "url.query": `?e=${e}&t=dummy-hmac`,
            "http.query": `e=${e}&t=dummy-hmac`,
            "http.method": "GET",
            "http.status_code": 200,
          },
        },
      },
    };

    scrubSentryEvent(event);

    expect(event.contexts?.trace?.data).toEqual({
      "http.target": "/unsubscribe",
      "http.url": "https://matio.tv/unsubscribe",
      "url.full": "https://matio.tv/unsubscribe",
      "http.method": "GET",
      "http.status_code": 200,
    });
    expect(JSON.stringify(event)).not.toContain(e);
  });

  it("cuts the headers, the IP and the body @sentry/nextjs 11 puts on spans (#390)", () => {
    // SDK 11 records a request the OpenTelemetry way: one attribute per
    // header (cookie included), the client's address, the body.
    const event: SentryEventLike = {
      transaction: "POST /api/email/unsubscribe",
      contexts: {
        trace: {
          data: {
            "http.request.header.cookie": ["__session=dummy-session"],
            "http.request.header.authorization": ["Bearer dummy-token"],
            "http.request.header.x-forwarded-for": ["203.0.113.7"],
            "http.request.header.user-agent": ["Mozilla/5.0"],
            "http.request.header.Content-Type": ["application/json"],
            "http.response.header.set-cookie": ["__session=dummy-session"],
            "http.response.header.content-length": ["12"],
            "client.address": "203.0.113.7",
            "network.peer.address": "203.0.113.7",
            "user.ip_address": "203.0.113.7",
            "http.request.body.data": '{"email":"viewer@example.invalid"}',
            "http.request.method": "POST",
          },
        },
      },
      spans: [
        { data: { "http.request.header.cookie": ["__session=dummy-session"] } },
      ],
    };

    scrubSentryEvent(event);

    expect(event.contexts?.trace?.data).toEqual({
      "http.request.header.user-agent": ["Mozilla/5.0"],
      "http.request.header.Content-Type": ["application/json"],
      "http.response.header.content-length": ["12"],
      "http.request.method": "POST",
    });
    expect(event.spans?.[0]?.data).toEqual({});
  });

  it("removes cookies, the request body and the parsed query", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    expect(event.request).not.toHaveProperty("cookies");
    expect(event.request).not.toHaveProperty("query_string");
    expect(event.request).not.toHaveProperty("data");
  });

  it("drops a server action's body — the /ideas pitch arrives as a JSON array carrying the whole story (#297)", () => {
    // A server action POSTs its arguments as a serialised array; for
    // submitIdea that is the fan's name, address and up to 10,000
    // characters of story. None of it may reach the tracker, whatever the
    // shape the SDK hands over.
    const MARKER_STORY = "Storymarker: the banished postman delivers his last letter";
    const pitch = {
      series: "new",
      workingTitle: "",
      logline: "What if a banished postman had one last letter to deliver?",
      story: MARKER_STORY,
      name: "Leak Marker",
      email: "leak.marker@example.invalid",
      ageConfirmed: true,
      termsAccepted: true,
      marketingOptIn: false,
      website: "",
    };
    for (const data of [JSON.stringify([pitch]), [pitch]]) {
      const event: SentryEventLike = {
        transaction: "POST /ideas",
        request: {
          url: "https://matio.tv/ideas",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          data,
        },
      };

      scrubSentryEvent(event);

      expect(event.request).not.toHaveProperty("data");
      const sent = JSON.stringify(event);
      expect(sent).not.toContain(MARKER_STORY);
      expect(sent).not.toContain("Leak Marker");
      expect(sent).not.toContain("leak.marker@example.invalid");
      // The request itself stays diagnosable.
      expect(event.request?.url).toBe("https://matio.tv/ideas");
    }
  });

  it("keeps only allowlisted headers, case-insensitively", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    // Cookie and Authorization are gone; the two diagnostics survive.
    expect(event.request?.headers).toEqual({
      "User-Agent": "Mozilla/5.0",
      "Content-Type": "application/json",
    });
  });

  it("reduces the user to an id", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    expect(event.user).toEqual({ id: "user_123" });
  });

  it("drops console breadcrumbs and keeps the rest", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    expect(event.breadcrumbs).toHaveLength(1);
    expect(event.breadcrumbs?.[0]?.category).toBe("fetch");
  });

  it("redacts addresses from the message and the exception value", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    expect(event.message).toBe("checkout claim failed for [redacted-email]");
    expect(event.exception?.values?.[0]?.value).toBe(
      "no reminder row for [redacted-email]",
    );
  });

  it("cuts the params of a failed query from the exception value, the message and the logentry (#326)", () => {
    // The class does not matter — a DrizzleQueryError, a wrapper that kept its
    // text, a captured message: the same `\nparams:` tail is cut wherever it is.
    const event: SentryEventLike = {
      message: DRIZZLE_MESSAGE,
      logentry: { message: DRIZZLE_MESSAGE },
      exception: {
        values: [
          { type: "PostgresError", value: "canceling statement due to statement timeout" },
          { type: "DrizzleQueryError", value: DRIZZLE_MESSAGE },
        ],
      },
    };

    scrubSentryEvent(event);

    expect(event.message).toBe(STATEMENT_ONLY);
    expect(event.logentry?.message).toBe(STATEMENT_ONLY);
    expect(event.exception?.values?.[0]?.value).toBe(
      "canceling statement due to statement timeout",
    );
    expect(event.exception?.values?.[1]).toEqual({
      type: "DrizzleQueryError", // the class stays — it is what the incident is searched by
      value: STATEMENT_ONLY,
    });
    const json = JSON.stringify(event);
    for (const param of [QUERY_UUID, QUERY_HASH, "show_1"]) {
      expect(json).not.toContain(param);
    }
  });

  it("cuts the params, then still redacts an address in the statement that is left", () => {
    const event: SentryEventLike = {
      exception: {
        values: [
          {
            value: `Failed query: select 1 -- viewer@example.invalid\nparams: ${QUERY_UUID}`,
          },
        ],
      },
    };

    scrubSentryEvent(event);

    expect(event.exception?.values?.[0]?.value).toBe(
      "Failed query: select 1 -- [redacted-email]",
    );
  });

  it("survives an event with nothing in it", () => {
    // Sentry sends plenty of these; a scrubber that throws would swallow the
    // error it was supposed to report.
    const event: SentryEventLike = {};

    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(event).toEqual({});
  });
});

// A Mux Data beacon host — the subdomain is the environment's public id; an
// obviously made-up one here.
const BEACON_HOST = "dummyenv123.litix.io";

/** The shape the browser SDK reports for a rejected `fetch` nobody caught. */
function fetchFailure(
  value: string,
  thrown: SentryExceptionValueLike = {},
): SentryEventLike {
  return {
    exception: {
      values: [
        { type: "TypeError", value, mechanism: { handled: false }, ...thrown },
      ],
    },
  };
}

describe("blocked Mux Data beacons (#265)", () => {
  // The point of every case but the first: `Failed to fetch` for OUR host is a
  // real incident (#259 read exactly like this family), so the filter must
  // never widen into "drop by text".

  it("drops an unhandled network failure of a litix beacon", () => {
    const { beforeSend } = sentryPrivacyOptions();

    expect(beforeSend(fetchFailure(`Failed to fetch (${BEACON_HOST})`))).toBeNull();
  });

  it("lets the very same failure through when the host is ours", () => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = fetchFailure("Failed to fetch (matio.tv)");

    expect(beforeSend(event)).toBe(event);
  });

  it("lets a HANDLED litix failure through — someone reported it on purpose", () => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = fetchFailure(`Failed to fetch (${BEACON_HOST})`, {
      mechanism: { handled: true },
    });

    expect(beforeSend(event)).toBe(event);
  });

  it("lets a non-TypeError through, whatever its text says", () => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = fetchFailure(`Failed to fetch (${BEACON_HOST})`, {
      type: "Error",
    });

    expect(beforeSend(event)).toBe(event);
  });

  it("survives events with no exception to look at", () => {
    // beforeSend is shared by Node, edge and the browser: message-only events,
    // an empty `exception`, an empty chain — none may throw, all must pass.
    const { beforeSend } = sentryPrivacyOptions();
    const shapes: SentryEventLike[] = [
      {},
      { message: `Failed to fetch (${BEACON_HOST})` },
      { exception: {} },
      { exception: { values: [] } },
      { exception: { values: [{ type: "TypeError", mechanism: { handled: false } }] } },
    ];

    for (const event of shapes) {
      expect(beforeSend(event)).toBe(event);
    }
  });

  it.each([
    ["Chromium", `Failed to fetch (${BEACON_HOST})`],
    ["Safari", `Load failed (${BEACON_HOST})`],
    ["Firefox", `NetworkError when attempting to fetch resource. (${BEACON_HOST})`],
    ["the bare domain", "Failed to fetch (litix.io)"],
    ["an upper-cased host", "Failed to fetch (DUMMYENV123.LITIX.IO)"],
  ])("recognises %s's spelling", (_name, value) => {
    expect(isBlockedBeaconNoise(fetchFailure(value))).toBe(true);
  });

  it.each([
    ["no host at all", "Failed to fetch"],
    ["a look-alike domain", "Failed to fetch (notlitix.io)"],
    ["litix as a subdomain of someone else", "Failed to fetch (litix.io.example.invalid)"],
    ["litix mentioned in other text", `beacon to ${BEACON_HOST} timed out`],
  ])("does not match %s", (_name, value) => {
    expect(isBlockedBeaconNoise(fetchFailure(value))).toBe(false);
  });

  it("requires handled to be exactly false, not merely absent", () => {
    // An event without a mechanism says nothing about who caught it — and
    // "unknown" must read as "report it".
    expect(
      isBlockedBeaconNoise(
        fetchFailure(`Failed to fetch (${BEACON_HOST})`, { mechanism: undefined }),
      ),
    ).toBe(false);
  });

  it("judges the thrown error, not a cause buried under it", () => {
    // Causes come first, the thrown error last. Our own error wrapping a litix
    // failure is OUR code speaking and must be reported.
    const event: SentryEventLike = {
      exception: {
        values: [
          {
            type: "TypeError",
            value: `Failed to fetch (${BEACON_HOST})`,
            mechanism: { handled: false },
          },
          {
            type: "Error",
            value: "player bootstrap failed",
            mechanism: { handled: false },
          },
        ],
      },
    };

    expect(isBlockedBeaconNoise(event)).toBe(false);
  });

  it("ignores a litix breadcrumb behind a failure of our own host", () => {
    // Every playback session has beacon fetches in its trail, so a breadcrumb
    // proves nothing about which request failed.
    const { beforeSend } = sentryPrivacyOptions();
    const event: SentryEventLike = {
      ...fetchFailure("Failed to fetch (matio.tv)"),
      breadcrumbs: [
        { category: "fetch", data: { url: `https://${BEACON_HOST}/` } },
      ],
    };

    expect(beforeSend(event)).toBe(event);
  });
});

// The page the stray script ran on. The browser SDK fills `request.url` from
// `location.href` before any hook runs (HttpContext's `preprocessEvent`).
const PAGE_URL = "https://matio.tv/watch/the-scarlet-oath";

const M_ID = "Cannot read properties of undefined (reading 'M_ID')";

/** A frame as `beforeSend` receives it — the filename already normalised. */
function frame(filename: string, lineno = 1, colno = 1): SentryStackFrameLike {
  return { filename, lineno, colno };
}

/** The stack of #271, oldest frame first as Sentry orders it: one file. */
const EXECUTOR_FRAMES = [
  frame("app:///executors/200.js", 1, 4410),
  frame("app:///executors/200.js", 1, 2210),
  frame("app:///executors/200.js", 1, 1830),
];

/** An unhandled error the way the browser SDK hands it to `beforeSend`. */
function thrownFrom(
  frames: SentryStackFrameLike[],
  thrown: SentryExceptionValueLike = {},
): SentryEventLike {
  return {
    request: { url: PAGE_URL },
    exception: {
      values: [
        {
          type: "TypeError",
          value: M_ID,
          mechanism: { handled: false },
          stacktrace: { frames },
          ...thrown,
        },
      ],
    },
  };
}

/**
 * The hint beside it: the thrown error itself, whose Chromium `stack` still
 * names every frame's real origin — the part the SDK wrote `app://` over.
 */
function thrownAt(...locations: string[]): SentryHintLike {
  return thrownWithMessage(M_ID, locations);
}

function thrownWithMessage(message: string, locations: string[]): SentryHintLike {
  const error = new TypeError(message);
  error.stack = [`TypeError: ${message}`, ...locations.map((at) => `    at f (${at})`)]
    .join("\n");
  return { originalException: error };
}

/** EXECUTOR_FRAMES' raw locations under one origin, newest first. */
function executorLocations(origin: string): string[] {
  return [
    `${origin}/executors/200.js:1:1830`,
    `${origin}/executors/200.js:1:2210`,
    `${origin}/executors/200.js:1:4410`,
  ];
}

describe("scripts injected into the page (#271)", () => {
  // Every case but the drops is a real error that must keep reaching the
  // tracker: the filter fails open, so each one pins a way it could widen.

  it.each([
    ["our own origin", "https://matio.tv"],
    // Chromium reports an extension's origin as `chrome-extension://<id>`, so
    // the SDK normalises its frames to `app:///…` exactly like ours.
    ["a Chromium extension", "chrome-extension://abcdefghijklmnop"],
  ])("drops an unhandled error thrown wholly by a stray script on %s", (_name, origin) => {
    const { beforeSend } = sentryPrivacyOptions();
    // The raw stack also holds the SDK's own XHR wrapper (in our chunk), which
    // the SDK strips from the frames — only the frames' locations are looked up.
    const hint = thrownAt(
      ...executorLocations(origin),
      "https://matio.tv/_next/static/chunks/sentry.js:2:300",
    );

    expect(beforeSend(thrownFrom(EXECUTOR_FRAMES), hint)).toBeNull();
  });

  it("keeps it the moment one frame is ours — our code may have called theirs", () => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = thrownFrom([
      ...EXECUTOR_FRAMES,
      frame("app:///_next/static/chunks/x.js", 1, 900),
    ]);
    const hint = thrownAt(
      ...executorLocations("https://matio.tv"),
      "https://matio.tv/_next/static/chunks/x.js:1:900",
    );

    expect(beforeSend(event, hint)).toBe(event);
  });

  it.each([
    "chrome-extension://abcdefghijklmnop/content.js",
    "moz-extension://0f1e2d3c-dummy/content.js",
    "safari-web-extension://0F1E2D3C-DUMMY/content.js",
    "safari-extension://com.example.dummy/content.js",
  ])("drops a stack made only of extension frames: %s", (filename) => {
    // Firefox and Safari report an extension's origin as `null`, so the scheme
    // survives normalisation and the frame proves itself — no hint needed.
    const { beforeSend } = sentryPrivacyOptions();

    expect(beforeSend(thrownFrom([frame(filename), frame(filename, 2, 7)]))).toBeNull();
  });

  it.each([
    // posthog-js 1.433 default (`strict_script_versioning: "fallback"`): the
    // lazy bundles carry the version in the PATH and no `?v=` — session
    // recording is on, surveys / exception autocapture / web vitals load alike.
    "ingest/static/1.433.4/lazy-recorder.js",
    // …and the remote config, a script of its own.
    "ingest/array/phc_dummy/config.js",
  ])("keeps PostHog's scripts, served from our own origin through /ingest: %s", (path) => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = thrownFrom([frame(`app:///${path}`, 1, 800), frame(`app:///${path}`, 1, 90)]);
    const hint = thrownAt(
      `https://matio.tv/${path}:1:90`,
      `https://matio.tv/${path}:1:800`,
    );

    expect(beforeSend(event, hint)).toBe(event);
  });

  it.each([
    ["a message of 20 000 scheme characters", "a".repeat(20_000)],
    ["a URL with a 20 000-character host", `https://${"a".repeat(20_000)}`],
  ])("reads a 50-frame stack in linear time despite %s", (_name, message) => {
    // The raw stack is scanned once per frame. Without a left boundary on the
    // scheme every offset of a long letter run restarts the match — tens of
    // seconds here, synchronously on the page's main thread. The 1 s ceiling
    // is loose on purpose: it tells linear from quadratic, not fast from slow.
    const { beforeSend } = sentryPrivacyOptions();
    const columns = Array.from({ length: 50 }, (_, i) => 10 * i + 1);
    const event = thrownFrom(columns.map((col) => frame("app:///executors/200.js", 1, col)));
    const hint = thrownWithMessage(
      message,
      columns.map((col) => `https://matio.tv/executors/200.js:1:${col}`),
    );

    const started = performance.now();
    const verdict = beforeSend(event, hint);
    const elapsed = performance.now() - started;

    expect(verdict).toBeNull();
    expect(elapsed).toBeLessThan(1000);
  });

  it("keeps an inline script of the page — its frame is the page, not a .js file", () => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = thrownFrom([frame("app:///watch/the-scarlet-oath", 12, 5)]);

    expect(beforeSend(event, thrownAt(`${PAGE_URL}:12:5`))).toBe(event);
  });

  it("keeps a vendor's script, both as a raw URL and as the SDK really sends it", () => {
    // Normalisation turns clerk.matio.tv's script into `app:///npm/…` too —
    // only the raw stack still says it is not ours.
    const { beforeSend } = sentryPrivacyOptions();
    const clerk = "https://clerk.matio.tv/npm/@clerk/clerk-js@6/dist/clerk.browser.js";
    const raw = thrownFrom([frame(clerk, 1, 500)]);
    const normalised = thrownFrom([
      frame("app:///npm/@clerk/clerk-js@6/dist/clerk.browser.js", 1, 500),
    ]);

    expect(beforeSend(raw)).toBe(raw);
    expect(beforeSend(normalised, thrownAt(`${clerk}:1:500`))).toBe(normalised);
  });

  it("survives events with no stack to look at", () => {
    // Shared by Node, edge and the browser: none of these may throw or drop.
    const { beforeSend } = sentryPrivacyOptions();
    const shapes: SentryEventLike[] = [
      {},
      { message: M_ID },
      { exception: {} },
      { exception: { values: [] } },
      thrownFrom([]),
      thrownFrom([], { stacktrace: undefined }),
      thrownFrom([], { stacktrace: {} }),
    ];
    const hints: (SentryHintLike | undefined)[] = [
      undefined,
      {},
      { originalException: M_ID },
      { originalException: null },
      { originalException: { stack: 42 } },
    ];

    for (const event of shapes) {
      for (const hint of hints) {
        expect(beforeSend(event, hint)).toBe(event);
      }
    }
  });

  it.each([
    "app:///.next/server/chunks/x.js",
    "app:///_next/server/chunks/ssr/x.js",
    "/var/task/node_modules/postgres/src/connection.js",
    "node:internal/process/task_queues",
  ])("never matches a server frame: %s", (filename) => {
    // Node and edge rewrite the dist dir to `app:///_next/…`, and a server
    // stack names file paths — there is no `scheme://host` to prove anything.
    const { beforeSend } = sentryPrivacyOptions();
    const event = thrownFrom([frame(filename)]);
    const hint = thrownAt(
      "/var/task/.next/server/chunks/x.js:1:1",
      "node:internal/process/task_queues:95:5",
    );

    expect(beforeSend(event)).toBe(event);
    expect(beforeSend(event, hint)).toBe(event);
  });

  it("reports an app:/// stack whose origin the raw stack does not confirm", () => {
    // `app:///x.js` alone is any origin at all: without the thrown error's own
    // stack, or when that stack does not hold the frame, it is doubt.
    const { beforeSend } = sentryPrivacyOptions();
    const event = thrownFrom(EXECUTOR_FRAMES);
    const noPage: SentryEventLike = { ...thrownFrom(EXECUTOR_FRAMES), request: undefined };

    expect(beforeSend(event)).toBe(event);
    expect(beforeSend(event, thrownAt("https://matio.tv/executors/200.js:9:9"))).toBe(event);
    expect(beforeSend(event, thrownAt(...executorLocations("https://bot.example.invalid"))))
      .toBe(event);
    // No page URL = no host to call "ours".
    expect(beforeSend(noPage, thrownAt(...executorLocations("https://matio.tv")))).toBe(noPage);
  });

  it.each([
    ["a frame with no filename", { lineno: 1, colno: 1 }],
    ["an <anonymous> frame", frame("<anonymous>")],
    ["a native frame", frame("native")],
  ])("keeps the stray stack when it also holds %s", (_name, doubt) => {
    const { beforeSend } = sentryPrivacyOptions();
    const event = thrownFrom([...EXECUTOR_FRAMES, doubt]);

    expect(beforeSend(event, thrownAt(...executorLocations("https://matio.tv")))).toBe(event);
  });

  it("lets a HANDLED error through — someone reported it on purpose", () => {
    const hint = thrownAt(...executorLocations("https://matio.tv"));

    expect(
      isInjectedScriptNoise(
        thrownFrom(EXECUTOR_FRAMES, { mechanism: { handled: true } }),
        hint,
      ),
    ).toBe(false);
    expect(
      isInjectedScriptNoise(thrownFrom(EXECUTOR_FRAMES, { mechanism: undefined }), hint),
    ).toBe(false);
  });
});

describe("sentryPrivacyOptions", () => {
  it("names every @sentry/nextjs 11 data category, each one off (#390)", () => {
    // SDK 11 removed `sendDefaultPii` and collects by default; a category
    // missing here is a category the SDK collects. lib/observability.sdk.test.ts
    // proves the real client reads these names.
    const options = sentryPrivacyOptions();

    expect(options.dataCollection).toEqual({
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
    // Streamed spans never reach beforeSendTransaction.
    expect(options.traceLifecycle).toBe("static");
    // Dead in SDK 11 — a value here would only look like protection.
    expect(options).not.toHaveProperty("sendDefaultPii");
    expect(options).not.toHaveProperty("enableLogs");
  });

  it("hands each init its own dataCollection, so one runtime cannot edit another's", () => {
    const first = sentryPrivacyOptions();
    first.dataCollection.httpHeaders.request.allow.push("cookie");

    expect(sentryPrivacyOptions().dataCollection.httpHeaders.request.allow).not.toContain(
      "cookie",
    );
  });

  it("gives the app the switches its SDK 10 core still reads, and the same hooks", () => {
    const app = sentryAppPrivacyOptions();

    expect(app.sendDefaultPii).toBe(false);
    expect(app.enableLogs).toBe(false);
    // A dataCollection would make SDK 10's core ignore sendDefaultPii.
    expect(app).not.toHaveProperty("dataCollection");
    expect(app.beforeSend(seededEvent())?.request?.url).toBe("https://matio.tv/welcome");
    expect(app.beforeSendTransaction(seededEvent()).request).not.toHaveProperty("cookies");
    expect(app.beforeBreadcrumb({ category: "console" })).toBeNull();
  });

  it("scrubs through beforeSend and beforeSendTransaction alike", () => {
    const options = sentryPrivacyOptions();

    const error = options.beforeSend(seededEvent());
    const transaction = options.beforeSendTransaction(seededEvent());

    for (const event of [error, transaction]) {
      expect(event?.request?.url).toBe("https://matio.tv/welcome");
      expect(event?.request).not.toHaveProperty("cookies");
    }
  });

  it("cuts a failed query's params through beforeSend and beforeBreadcrumb (#326)", () => {
    const options = sentryPrivacyOptions();

    const error = options.beforeSend({
      exception: { values: [{ type: "DrizzleQueryError", value: DRIZZLE_MESSAGE }] },
    });
    const crumb = options.beforeBreadcrumb({
      category: "sentry.event",
      message: DRIZZLE_MESSAGE,
    });

    expect(error?.exception?.values?.[0]?.value).toBe(STATEMENT_ONLY);
    expect(crumb?.message).toBe(STATEMENT_ONLY);
  });

  it("scrubs the root span's http.target in a transaction (#346)", () => {
    const options = sentryPrivacyOptions();
    const transaction = options.beforeSendTransaction({
      transaction: "POST /api/email/unsubscribe",
      contexts: {
        trace: { data: { "http.target": "/api/email/unsubscribe?e=dmlld2Vy&t=dummy" } },
      },
    });

    expect(transaction.contexts?.trace?.data).toEqual({
      "http.target": "/api/email/unsubscribe",
    });
  });

  it("returns the event itself, so nothing else in the pipeline is lost", () => {
    const options = sentryPrivacyOptions();
    const event = seededEvent();

    expect(options.beforeSend(event)).toBe(event);
  });

  it("drops console breadcrumbs at capture time", () => {
    const options = sentryPrivacyOptions();

    expect(options.beforeBreadcrumb({ category: "console" })).toBeNull();
    expect(options.beforeBreadcrumb({ category: "fetch" })).not.toBeNull();
  });
});
