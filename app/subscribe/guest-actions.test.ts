import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The pay-first GUEST checkout builder (#224 — the guest half of "not more
// than one open, billable Checkout Session per buyer", ADR 0002). The subject
// is the glue around Stripe: what gets created, what gets EXPIRED, and what
// the browser is handed — with the same stateful Stripe fake the signed-in
// suite runs on (tools/test/stripe-checkout-fake.ts), so "Stripe" means the
// same thing in both.
//
// A guest has no Stripe customer before payment, so the sweep cannot list by
// customer: the previous session id is remembered under the claim cookie's
// hash (lib/guest-checkout-sessions.ts). That module's own statement is
// pinned in lib/guest-checkout-sessions.test.ts; here it is replaced by an
// in-memory table with the SAME contract (swap in the new id, hand back the
// old one), plus a fault switch.
const fake = await vi.hoisted(async () =>
  (await import("@/tools/test/stripe-checkout-fake")).createStripeCheckoutFake(),
);
const st = fake.state;

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  userAgent: "Mozilla/5.0 (iPhone) Safari",
  clientIp: "203.0.113.7",
  authUserId: null as string | null,
  rateLimited: false,
  rateLimitCalls: [] as string[],
  cookies: {} as Record<string, string>,
  cookieSets: [] as Array<{ name: string; value: string; opts: Record<string, unknown> }>,
  // The remembered-session table: claim hash → last session id.
  claims: new Map<string, string>(),
  claimCalls: [] as Array<{ hash: string; sessionId: string }>,
  // Fault injection for the claim: which call (1-based) throws — `1` is the
  // claim itself, `2` the rollback after a failed expire — and a hook run
  // before a call, to play a third tab claiming in between.
  claimFailOn: null as number | null,
  beforeClaim: null as ((call: number) => void) | null,
  capiEvents: [] as unknown[],
  posthogEvents: [] as unknown[],
}));

function select() {
  const result = h.selects.shift() ?? [];
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => result,
  };
  return chain;
}

vi.mock("@/db", () => ({ db: { select } }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.authUserId }),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "user-agent": h.userAgent,
      "x-vercel-forwarded-for": h.clientIp,
    }),
  cookies: async () => ({
    get: (name: string) =>
      name in h.cookies ? { value: h.cookies[name] } : undefined,
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      h.cookieSets.push({ name, value, opts });
    },
  }),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: () => fake.stripe }));

vi.mock("@/lib/checkout-rate-limit", () => ({
  guestCheckoutRateLimited: async (ipHash: string) => {
    h.rateLimitCalls.push(ipHash);
    return h.rateLimited;
  },
}));

// The real hashClaimToken (the privacy pin below is about it); the claim
// itself is the in-memory table — its SQL is the other suite's subject.
vi.mock("@/lib/guest-checkout-sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/guest-checkout-sessions")>();
  return {
    ...actual,
    claimSoleGuestSession: async (_db: unknown, hash: string, sessionId: string) => {
      h.claimCalls.push({ hash, sessionId });
      h.beforeClaim?.(h.claimCalls.length);
      if (h.claimFailOn === h.claimCalls.length) throw new Error("db down");
      const previous = h.claims.get(hash) ?? null;
      h.claims.set(hash, sessionId);
      return previous;
    },
  };
});

// The UTM snapshot is not under test here, and lib/attribution.ts reaches
// next/headers through a dynamic import that vitest's mocker resolves to the
// REAL module when two of them are in flight at once (the parallel-tab case
// below). Inert, like the signed-in suite does it.
vi.mock("@/lib/attribution", () => ({
  readAttributionCookies: async () => ({
    first: { source: "tiktok", medium: null, campaign: null },
    last: { source: null, medium: null, campaign: null },
  }),
  toStripeMetadata: () => ({ attr_first_source: "tiktok" }),
}));

vi.mock("@/lib/checkout-target", () => ({
  resolveCheckoutTarget: async (input: { resume?: string | null }) => ({
    showSlug: "the-scarlet-oath",
    episodeId: "ep-3",
    resume: input.resume ?? null,
  }),
  buildWatchPath: (target: { resume: string | null }) =>
    `/watch/the-scarlet-oath?ep=ep-3${target.resume ? `&resume=${target.resume}` : ""}`,
}));

vi.mock("@/lib/i18n/server", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { getDict: async () => ({ locale: "en", t: en }) };
});

vi.mock("@/lib/capi-identity", () => ({
  readCapiIdentity: async () => ({ fbp: "fb.1", fbc: null, ip: "1.2.3.4", ua: "UA" }),
  toCapiMetadata: () => ({ capi_consent: "1", capi_fbp: "fb.1" }),
}));

vi.mock("@/lib/meta-capi", () => ({
  sendCapiEvents: async (events: unknown[]) => {
    h.capiEvents.push(...events);
  },
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: async (event: unknown) => {
    h.posthogEvents.push(event);
  },
  toPosthogConsentMetadata: () => ({ ph_consent: "1" }),
}));

import { CONSENT_VERSION, serializeConsent } from "@/lib/cookie-consent";
import { hashClaimToken } from "@/lib/guest-checkout-sessions";

import { createGuestCheckoutSession } from "./guest-actions";

const INPUT = { show: "the-scarlet-oath", ep: "ep-3", resume: "128" };
// A browser that already holds a claim cookie — every tab it opens is this
// one buying party.
const CLAIM = "5b1c9e0a-2d4f-4c8e-9a7b-3f6d1e2c4b5a";

const CONSENT_GIVEN = () =>
  serializeConsent({
    necessary: true,
    marketing: true,
    ts: 0,
    v: CONSENT_VERSION,
  });

const openSessionIds = () =>
  st.sessions.filter((s) => s.status === "open").map((s) => s.id);

const statusOf = (id: string) => st.sessions.find((s) => s.id === id)?.status;

beforeEach(() => {
  fake.reset();
  h.selects = [];
  h.userAgent = "Mozilla/5.0 (iPhone) Safari";
  h.clientIp = "203.0.113.7";
  h.authUserId = null;
  h.rateLimited = false;
  h.rateLimitCalls = [];
  h.cookies = { checkout_claim: CLAIM, cookie_consent: CONSENT_GIVEN() };
  h.cookieSets = [];
  h.claims = new Map();
  h.claimCalls = [];
  h.claimFailOn = null;
  h.beforeClaim = null;
  h.capiEvents = [];
  h.posthogEvents = [];
  vi.stubEnv("PAYMENTS_ENABLED", "1");
  vi.stubEnv("PAY_FIRST_CHECKOUT", "1");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_x");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
  vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", "dummy-signing-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// #224 — not more than one open, billable session per guest buyer.
// ---------------------------------------------------------------------------
describe("#224 — one open session per guest buyer", () => {
  it("(а) metadata drift between two tabs — a different resume playhead — leaves exactly ONE session open, the newer one", async () => {
    // Ten seconds further along in the other tab: the return URLs differ,
    // which under the old hour-bucketed key was a second key, a second
    // live session and a second $25 waiting for a second tap.
    await createGuestCheckoutSession({ ...INPUT, resume: "128" });
    await createGuestCheckoutSession({ ...INPUT, resume: "138" });

    expect(st.sessions).toHaveLength(2);
    expect(st.sessions[0].params.return_url).toContain("resume=128");
    expect(st.sessions[1].params.return_url).toContain("resume=138");
    expect(statusOf("cs_test_1")).toBe("expired");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("(б) two tabs creating IN PARALLEL end with exactly one open session — the action's create → claim → expire order, on the in-memory claim", async () => {
    // What this proves is the ORDER inside the action: each tab claims only
    // after its own create, so whichever claims last is handed the other's
    // id and expires it. The atomicity of the claim itself under two real
    // connections is not this fake's to prove — it rests on the statement
    // pinned by text in lib/guest-checkout-sessions.test.ts (`… RETURNING
    // old.session_id`) and on the two-session check against Postgres 18.4
    // recorded in ADR 0002.
    await Promise.all([
      createGuestCheckoutSession({ ...INPUT, resume: "128" }),
      createGuestCheckoutSession({ ...INPUT, resume: "138" }),
    ]);

    expect(st.sessions).toHaveLength(2);
    expect(openSessionIds()).toHaveLength(1);
  });

  it("(в) an expire that fails because somebody else already closed the previous session is fine — and nothing is rolled back", async () => {
    // The buyer paid in the other tab a moment earlier (or a parallel sweep
    // got there first) — the state the sweep wanted is already there, so the
    // table keeps naming the NEW session.
    await createGuestCheckoutSession(INPUT);
    st.fault = { on: "expire", then: "closed_by_other" };

    const res = await createGuestCheckoutSession(INPUT);

    expect(res).toMatchObject({ kind: "embedded", sessionId: "cs_test_2" });
    expect(statusOf("cs_test_1")).toBe("complete");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
    expect(h.claims.get(hashClaimToken(CLAIM))).toBe("cs_test_2");
    expect(h.claimCalls).toHaveLength(2);
  });

  it("(г) an expire that fails while the previous session is STILL open closes the new session and throws", async () => {
    // Fail closed on the money path: a client secret is handed out only once
    // the previous session is provably not payable. Here it still is, so the
    // buyer gets no second live session — and no intent events either.
    await createGuestCheckoutSession(INPUT);
    h.capiEvents = [];
    h.posthogEvents = [];
    st.fault = { on: "expire", then: "still_open" };

    await expect(createGuestCheckoutSession(INPUT)).rejects.toThrow(
      "stripe expire failed",
    );

    expect(statusOf("cs_test_2")).toBe("expired");
    expect(openSessionIds()).toEqual(["cs_test_1"]);
    expect(h.capiEvents).toHaveLength(0);
    expect(h.posthogEvents).toHaveLength(0);
  });

  it("(г′) after that failure the table points at the previous session AGAIN — the next checkout retries it and succeeds, one session open", async () => {
    // The claim had already replaced cs_test_1 with cs_test_2 when the
    // expire failed. Without the rollback the next checkout would be handed
    // cs_test_2 (dead), find nothing to expire, and cs_test_1 + cs_test_3
    // would both be live — the #224 defect, one step later.
    const hash = hashClaimToken(CLAIM);
    await createGuestCheckoutSession(INPUT);
    st.fault = { on: "expire", then: "still_open" };
    await expect(createGuestCheckoutSession(INPUT)).rejects.toThrow();

    expect(h.claims.get(hash)).toBe("cs_test_1");
    expect(h.claimCalls.map((c) => c.sessionId)).toEqual(["cs_test_1", "cs_test_2", "cs_test_1"]);

    const third = await createGuestCheckoutSession(INPUT);

    expect(third).toMatchObject({ kind: "embedded", sessionId: "cs_test_3" });
    expect(st.expireCalls).toEqual(["cs_test_1", "cs_test_2", "cs_test_1"]);
    expect(openSessionIds()).toEqual(["cs_test_3"]);
    expect(h.claims.get(hash)).toBe("cs_test_3");
  });

  it("the rollback displacing a THIRD tab's id is logged by ids — that session stays open, an accepted residual", async () => {
    const hash = hashClaimToken(CLAIM);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await createGuestCheckoutSession(INPUT);
    st.fault = { on: "expire", then: "still_open" };
    // Between tab 2's claim (call 2) and its rollback (call 3), tab 3 claims.
    h.beforeClaim = (call) => {
      if (call === 3) h.claims.set(hash, "cs_third_tab");
    };

    await expect(createGuestCheckoutSession(INPUT)).rejects.toThrow();

    expect(h.claims.get(hash)).toBe("cs_test_1");
    expect(error.mock.calls.map(([line]) => line)).toContain(
      "startGuestCheckout: rolling back the claim displaced a newer session — it stays open and unrecorded",
    );
    const displaced = error.mock.calls.find(([line]) =>
      String(line).includes("displaced a newer session"),
    );
    expect(displaced?.[1]).toEqual({
      previousSessionId: "cs_test_1",
      displacedSessionId: "cs_third_tab",
      sessionId: "cs_test_2",
    });
  });

  it("the rollback itself failing is logged and the action still fails closed", async () => {
    const hash = hashClaimToken(CLAIM);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await createGuestCheckoutSession(INPUT);
    st.fault = { on: "expire", then: "still_open" };
    h.claimFailOn = 3;

    await expect(createGuestCheckoutSession(INPUT)).rejects.toThrow("stripe expire failed");

    // The double fault: the table keeps naming the closed session, the
    // previous one stays open until Stripe expires it on its own.
    expect(h.claims.get(hash)).toBe("cs_test_2");
    expect(statusOf("cs_test_2")).toBe("expired");
    expect(error.mock.calls.map(([line]) => line)).toContain(
      "startGuestCheckout: rolling back the claim failed — the previous session stays unrecorded",
    );
  });

  it("(д) creates the session with NO idempotency key — the guard against adding one back", async () => {
    // Stripe replays the CACHED first response for a key, `status: 'open'`
    // included, long after the sweep of a newer session expired it: with a
    // key, a buyer coming back to their first tab would be handed that dead
    // session on every retry until the hour rolled.
    await createGuestCheckoutSession(INPUT);
    await createGuestCheckoutSession(INPUT);

    expect(st.sessions).toHaveLength(2);
    expect(st.sessions.every((s) => s.opts === undefined)).toBe(true);
  });

  it("a browser's FIRST checkout has nothing to expire — one create, no expire call", async () => {
    const res = await createGuestCheckoutSession(INPUT);

    expect(res).toMatchObject({ kind: "embedded", sessionId: "cs_test_1" });
    expect(st.expireCalls).toEqual([]);
    expect(openSessionIds()).toEqual(["cs_test_1"]);
  });

  it("remembers the session under an HMAC of the claim cookie — never the cookie itself", async () => {
    // The cookie is what /welcome compares against client_reference_id
    // before minting a sign-in ticket; the table must not hold it in clear.
    await createGuestCheckoutSession(INPUT);

    expect(h.claimCalls).toEqual([{ hash: hashClaimToken(CLAIM), sessionId: "cs_test_1" }]);
    expect(h.claimCalls[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.claimCalls[0].hash).not.toContain(CLAIM);
  });

  it("the sweep runs on the hosted fallback too — a webview buyer holds one session as well", async () => {
    h.userAgent = "Mozilla/5.0 (iPhone) Instagram 300.0";

    await createGuestCheckoutSession(INPUT);
    const second = await createGuestCheckoutSession(INPUT);

    expect(second).toEqual({ kind: "hosted", url: "https://checkout.stripe.com/cs_test_2" });
    expect(st.sessions[1].params.ui_mode).toBeUndefined();
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("cannot record the session → closes it and throws, rather than handing out a secret nobody can sweep", async () => {
    // Unlike the rate limiter (fail-open: an anti-abuse blip must not block
    // revenue), the claim is the money path: a session that is not on
    // record is one the NEXT creation can never find and expire.
    h.claimFailOn = 1;

    await expect(createGuestCheckoutSession(INPUT)).rejects.toThrow("db down");

    expect(statusOf("cs_test_1")).toBe("expired");
    expect(openSessionIds()).toEqual([]);
    expect(h.capiEvents).toHaveLength(0);
    // Nothing was claimed, so there is nothing to roll back.
    expect(h.claimCalls).toHaveLength(1);
  });

  it("a fresh browser (no claim cookie) mints its own token, so it is a different buying party", async () => {
    // Two different browsers must NOT expire each other's sessions.
    await createGuestCheckoutSession(INPUT);
    delete h.cookies.checkout_claim;

    await createGuestCheckoutSession(INPUT);

    expect(h.claimCalls[1].hash).not.toBe(h.claimCalls[0].hash);
    expect(openSessionIds()).toEqual(["cs_test_1", "cs_test_2"]);
    const minted = h.cookieSets.at(-1);
    expect(minted?.name).toBe("checkout_claim");
    expect(minted?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted?.opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});

// The rest of the builder must be exactly what it was — the refactor around
// the create call changed nothing about what is sold or what /welcome depends
// on.
describe("createGuestCheckoutSession — unchanged around the sweep", () => {
  it("hands the /checkout client the client secret AND the session id (the refocus probe needs it)", async () => {
    const res = await createGuestCheckoutSession(INPUT);

    expect(res).toEqual({
      kind: "embedded",
      clientSecret: "cs_test_1_secret",
      sessionId: "cs_test_1",
    });
  });

  it("binds the session to the browser: client_reference_id = the claim cookie, guest markers in the metadata", async () => {
    h.cookies.trial_session = "trial-token-1";
    h.selects = [[]];

    await createGuestCheckoutSession(INPUT);

    const { params } = st.sessions[0];
    expect(params.client_reference_id).toBe(CLAIM);
    expect(params.customer).toBeUndefined();
    const meta = (params.subscription_data as { metadata: Record<string, string> }).metadata;
    expect(meta).toMatchObject({
      guest: "1",
      claim_token: CLAIM,
      trial_token: "trial-token-1",
      attr_first_source: "tiktok",
      capi_consent: "1",
      ph_consent: "1",
    });
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([{ price: "price_monthly", quantity: 1 }]);
  });

  it("returns the top frame to /welcome with Stripe's own placeholder", async () => {
    await createGuestCheckoutSession(INPUT);

    expect(st.sessions[0].params.return_url).toBe(
      "https://matio.tv/welcome?session_id={CHECKOUT_SESSION_ID}&show=the-scarlet-oath&ep=ep-3&resume=128",
    );
  });

  it("fires the checkout-intent signals after the sweep, keyed on the live session", async () => {
    h.cookies[`ph_${"phc_test"}_posthog`] = JSON.stringify({ distinct_id: "device-1" });
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");

    await createGuestCheckoutSession(INPUT);

    expect(h.capiEvents).toEqual([
      expect.objectContaining({ eventName: "InitiateCheckout", eventId: "cs_test_1" }),
    ]);
    expect(h.posthogEvents).toEqual([
      expect.objectContaining({
        event: "checkout_started",
        distinctId: "device-1",
        properties: expect.objectContaining({ flow: "pay_first", utm_source: "tiktok" }),
      }),
    ]);
  });

  it("still sells without marketing consent — no snapshots, no intent events", async () => {
    delete h.cookies.cookie_consent;

    const res = await createGuestCheckoutSession(INPUT);

    expect(res.kind).toBe("embedded");
    const meta = (st.sessions[0].params.subscription_data as { metadata: Record<string, string> }).metadata;
    expect(meta.capi_consent).toBeUndefined();
    expect(meta.ph_consent).toBeUndefined();
    expect(h.capiEvents).toHaveLength(0);
    expect(h.posthogEvents).toHaveLength(0);
  });
});

describe("createGuestCheckoutSession — refusals reach Stripe as silence", () => {
  it("redirects home while payments are off", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");

    expect(await createGuestCheckoutSession(INPUT)).toEqual({ kind: "redirect", to: "/" });
    expect(st.sessions).toHaveLength(0);
    expect(h.claimCalls).toHaveLength(0);
  });

  it("hands over to the auth flow with the pay-first flag off", async () => {
    vi.stubEnv("PAY_FIRST_CHECKOUT", "");

    expect(await createGuestCheckoutSession(INPUT)).toEqual({
      kind: "redirect",
      to: "/subscribe?show=the-scarlet-oath&ep=ep-3&resume=128",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("hands a signed-in caller over to the auth flow — that flow owns the customer and the duplicate guards", async () => {
    h.authUserId = "user_1";

    expect(await createGuestCheckoutSession(INPUT)).toMatchObject({ kind: "redirect" });
    expect(st.sessions).toHaveLength(0);
  });

  it("degrades into the auth flow over the per-IP rate limit, before any Stripe work", async () => {
    h.rateLimited = true;

    expect(await createGuestCheckoutSession(INPUT)).toMatchObject({ kind: "redirect" });
    expect(st.sessions).toHaveLength(0);
    expect(h.rateLimitCalls).toHaveLength(1);
    expect(h.rateLimitCalls[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("routes a browser whose trial is linked to a live subscriber into the auth flow", async () => {
    h.cookies.trial_session = "trial-token-1";
    h.selects = [[{ id: "sub_existing" }]];

    expect(await createGuestCheckoutSession(INPUT)).toMatchObject({ kind: "redirect" });
    expect(st.sessions).toHaveLength(0);
  });
});
