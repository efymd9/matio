import { describe, expect, it } from "vitest";

import {
  redactEmails,
  resolveRelease,
  resolveStage,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  scrubUrl,
  sentryPrivacyOptions,
  type SentryEventLike,
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
    spans: [{ data: { "http.url": "https://api.stripe.com/v1/x?key=sk-test-1" } }],
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
    });
  });

  it("removes cookies, the request body and the parsed query", () => {
    const event = seededEvent();

    scrubSentryEvent(event);

    expect(event.request).not.toHaveProperty("cookies");
    expect(event.request).not.toHaveProperty("query_string");
    expect(event.request).not.toHaveProperty("data");
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

  it("survives an event with nothing in it", () => {
    // Sentry sends plenty of these; a scrubber that throws would swallow the
    // error it was supposed to report.
    const event: SentryEventLike = {};

    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect(event).toEqual({});
  });
});

describe("sentryPrivacyOptions", () => {
  it("states the two settings that must never drift", () => {
    const options = sentryPrivacyOptions();

    expect(options.sendDefaultPii).toBe(false);
    expect(options.enableLogs).toBe(false);
  });

  it("scrubs through beforeSend and beforeSendTransaction alike", () => {
    const options = sentryPrivacyOptions();

    const error = options.beforeSend(seededEvent());
    const transaction = options.beforeSendTransaction(seededEvent());

    for (const event of [error, transaction]) {
      expect(event.request?.url).toBe("https://matio.tv/welcome");
      expect(event.request).not.toHaveProperty("cookies");
    }
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
