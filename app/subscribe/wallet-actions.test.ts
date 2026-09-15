import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The signed-in checkout builders — the paywall's in-place wallet checkout
// (#210) and the /checkout form it shares prepareAuthCheckout with. The subject
// here is the glue the pure rules cannot cover: which Stripe calls are made (or,
// more often, NOT made), what lands in the Checkout Session, what the buyer's
// browser is handed back — and, since #217, what happens to the buyer's OTHER
// sessions when a new one is created. The gate table itself is pinned in
// lib/wallet-checkout.test.ts; the two-surface parity is pinned in
// lib/checkout-session-params.test.ts.
//
// The db is the queue-driven fake used by the admin action suites: each
// db.select() resolves to the next queued result.
//
// The Stripe fake is STATEFUL, because the #217 invariant is about lifecycle
// (a session is created open, `list` filters by customer + status, `expire`
// refuses a closed session, `create` replays the CACHED response for a
// repeated idempotency key). It lives in tools/test/stripe-checkout-fake.ts,
// shared with the guest suite (#224) so the two cannot drift in what "Stripe"
// means; `st` is its state — sessions, customers, one-shot faults, paging.
const fake = await vi.hoisted(async () =>
  (await import("@/tools/test/stripe-checkout-fake")).createStripeCheckoutFake(),
);
const st = fake.state;

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  userCustomerId: "cus_existing" as string | null,
  userUpdates: [] as unknown[],
  userAgent: "Mozilla/5.0 (iPhone) Safari",
  // Built with the real serializer, not a hand-written literal: parseConsent
  // also requires the version field, and a literal that silently fails to
  // parse would make every consent-gated assertion below vacuous.
  consentCookie: undefined as string | undefined,
  authUserId: "user_1" as string | null,
  capiThrows: false,
  capiEvents: [] as unknown[],
  posthogEvents: [] as unknown[],
}));

function select() {
  const result = h.selects.shift() ?? [];
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: async () => result,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(result).then(res, rej),
  };
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select,
    update: () => ({
      set: (values: unknown) => {
        h.userUpdates.push(values);
        return { where: async () => undefined };
      },
    }),
  },
}));

vi.mock("@/lib/admin", () => ({
  getOrSyncCurrentUser: vi.fn(async () =>
    h.authUserId
      ? {
          id: h.authUserId,
          email: "buyer@example.test",
          stripeCustomerId: h.userCustomerId,
        }
      : null,
  ),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.authUserId }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": h.userAgent }),
  cookies: async () => ({
    get: (name: string) =>
      name === "cookie_consent" && h.consentCookie !== undefined
        ? { value: h.consentCookie }
        : undefined,
  }),
}));

vi.mock("@/lib/stripe", () => ({ getStripe: () => fake.stripe }));

// The UTM snapshot is not under test here, and lib/attribution.ts reaches
// next/headers through a dynamic import that vitest's mocker resolves to the
// REAL module when two of them are in flight at once (the parallel-tab case
// below). Inert, like the log audit does it.
vi.mock("@/lib/attribution", () => ({
  readAttributionCookies: async () => ({
    first: { source: null, medium: null, campaign: null },
    last: { source: null, medium: null, campaign: null },
  }),
  toStripeMetadata: () => ({}),
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
  readCapiIdentity: async () => {
    if (h.capiThrows) throw new Error("no headers");
    return { fbp: "fb.1", fbc: null, ip: "1.2.3.4", ua: "UA" };
  },
  toCapiMetadata: () => ({ capi_consent: "1", capi_fbp: "fb.1" }),
}));

vi.mock("@/lib/meta-capi", () => ({
  sendCapiEvents: vi.fn(async (events: unknown[]) => {
    h.capiEvents.push(...events);
  }),
}));

vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: async (event: unknown) => {
    h.posthogEvents.push(event);
  },
  toPosthogConsentMetadata: () => ({ ph_consent: "1" }),
}));

import { CONSENT_VERSION, serializeConsent } from "@/lib/cookie-consent";

import {
  createAuthCheckoutSession,
  createAuthWalletCheckoutSession,
  reportWalletCheckoutStarted,
} from "./actions";

const INPUT = { show: "the-scarlet-oath", ep: "ep-3", resume: "128" };

const CONSENT_GIVEN = () =>
  serializeConsent({
    necessary: true,
    marketing: true,
    ts: 0,
    v: CONSENT_VERSION,
  });

const metadataOf = (i: number) =>
  (st.sessions[i].params.subscription_data as { metadata: Record<string, string> })
    .metadata;

const openSessionIds = () =>
  st.sessions.filter((s) => s.status === "open").map((s) => s.id);

beforeEach(() => {
  fake.reset();
  h.selects = [[]];
  h.userCustomerId = "cus_existing";
  h.userUpdates = [];
  h.userAgent = "Mozilla/5.0 (iPhone) Safari";
  h.consentCookie = CONSENT_GIVEN();
  h.authUserId = "user_1";
  h.capiThrows = false;
  h.capiEvents = [];
  h.posthogEvents = [];
  vi.stubEnv("PAYMENTS_ENABLED", "1");
  vi.stubEnv("WALLET_EXPRESS_CHECKOUT", "1");
  vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_x");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://matio.tv");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createAuthWalletCheckoutSession — refusals reach Stripe as silence", () => {
  it("redirects and creates NOTHING while payments are off", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");

    const res = await createAuthWalletCheckoutSession(INPUT, true);

    expect(res).toEqual({ kind: "redirect", to: "/" });
    // The action is independently POST-invocable; the paywall's own gating is
    // never the only thing between free mode and a real charge.
    expect(st.sessions).toHaveLength(0);
  });

  it("is unavailable — and silent — with the kill-switch unset", async () => {
    vi.stubEnv("WALLET_EXPRESS_CHECKOUT", "");

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("is unavailable with no publishable key — a dead slot is worse than none", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("is unavailable inside the Instagram webview", async () => {
    // Google Pay cannot render in an iOS webview at all, and the sheet is
    // unreliable in Android's — ~60% of ad traffic lands here.
    h.userAgent = "Mozilla/5.0 (iPhone) Instagram 300.0";

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("is unavailable for an anonymous buyer in v1", async () => {
    h.authUserId = null;

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("refuses to sell without the withdrawal waiver", async () => {
    // Stripe cannot collect it on this surface, so an unticked box arriving
    // here means the client was bypassed — not that the buyer consented.
    expect(await createAuthWalletCheckoutSession(INPUT, false)).toEqual({
      kind: "unavailable",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("redirects a buyer who already holds an access-granting row", async () => {
    h.selects = [[{ id: "sub_existing" }]];

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("redirects when Stripe itself still shows a live subscription", async () => {
    // The DB mirror can lag behind an in-flight webhook; Stripe is the
    // source of truth, and a double-tap here is a second $25/mo charge.
    st.stripeSubs = [{ status: "active" }];

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(st.sessions).toHaveLength(0);
  });
});

describe("createAuthWalletCheckoutSession — the session it builds", () => {
  it("creates an elements-mode subscription session for the membership price", async () => {
    const res = await createAuthWalletCheckoutSession(INPUT, true);

    const { params } = st.sessions[0];
    expect(params.ui_mode).toBe("elements");
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price: "price_monthly", quantity: 1 },
    ]);
    expect(res.kind).toBe("wallet");
  });

  it("keeps tax and address collection — renewals must invoice correctly", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const { params } = st.sessions[0];
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    expect(params.customer).toBe("cus_existing");
  });

  it("omits the consent params Stripe rejects on this ui_mode", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    // `custom_text` is a hard 400 here and `consent_collection` has no
    // renderer — the waiver moved into our own checkbox instead.
    const { params } = st.sessions[0];
    expect(params.custom_text).toBeUndefined();
    expect(params.consent_collection).toBeUndefined();
  });

  it("records WHICH terms were accepted — and no acceptance time", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const meta = metadataOf(0);
    expect(meta.tos_version).toBe("2026-09-09");
    // The exact moment is Stripe's own session `created`; a second clock in
    // the record would be a second, contestable answer (#214).
    expect(meta).not.toHaveProperty("tos_accepted_at");
  });

  it("carries the whole metadata channel the cookie-less webhook depends on", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const meta = metadataOf(0);
    // Drop any of these and the webhook loses the user, the campaign, or the
    // consent sentinel that decides whether Purchase may fire at all.
    expect(meta.userId).toBe("user_1");
    expect(meta.capi_consent).toBe("1");
    expect(meta.ph_consent).toBe("1");
  });

  it("hands back the real session id baked into the return URL", async () => {
    const res = await createAuthWalletCheckoutSession(INPUT, true);

    // No Stripe redirect substitutes {CHECKOUT_SESSION_ID} on an inline
    // confirm, so the server does it — and the return leg re-verifies it at
    // Stripe against this user's customer regardless.
    expect(res).toMatchObject({
      kind: "wallet",
      clientSecret: "cs_test_1_secret",
      sessionId: "cs_test_1",
    });
    expect(res.kind === "wallet" && res.returnUrl).toContain("cs=cs_test_1");
    expect(res.kind === "wallet" && res.returnUrl).not.toContain(
      "CHECKOUT_SESSION_ID",
    );
  });

  it("puts no clock reading anywhere in the metadata", async () => {
    // Data minimisation, and one answer to "when": any ISO timestamp here
    // would be a second, contestable record of the acceptance moment.
    await createAuthWalletCheckoutSession(INPUT, true);

    for (const value of Object.values(metadataOf(0))) {
      expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:/);
    }
  });

  it("fires NO checkout-intent events at creation — the wall is not intent", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    // They fire from reportWalletCheckoutStarted at confirm instead, or
    // checkout_started degrades into a wall-impression counter and the saved
    // PostHog funnel stops meaning anything.
    expect(h.capiEvents).toHaveLength(0);
    expect(h.posthogEvents).toHaveLength(0);
  });

  it("still sells when marketing consent is absent — just without the snapshots", async () => {
    h.consentCookie = undefined;

    await createAuthWalletCheckoutSession(INPUT, true);

    const meta = metadataOf(0);
    expect(meta.capi_consent).toBeUndefined();
    expect(meta.ph_consent).toBeUndefined();
    expect(meta.tos_version).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// #217 — not more than one open, billable Checkout Session per buyer.
// ---------------------------------------------------------------------------
// The four ways one buyer used to end up with TWO live sessions (each one a
// second $25 waiting for a second tap), reproduced as behaviour: after the
// second creation exactly one session of that customer is still open, and it
// is the newer one. Before the sweep every one of these left both open.
describe("#217 — one open session per buyer", () => {
  it("scenario 1: metadata drift between tabs — a consent banner accepted between two wall impressions", async () => {
    // Tab 1 opened the wall before the cookie banner was answered; tab 2 after
    // "Accept all". The subscription metadata legitimately differs (consent
    // sentinels + CAPI identity), which is what split the old hour-bucketed
    // idempotency key into two keys and two live sessions.
    h.consentCookie = undefined;
    await createAuthWalletCheckoutSession(INPUT, true);
    h.consentCookie = CONSENT_GIVEN();
    await createAuthWalletCheckoutSession(INPUT, true);

    expect(st.sessions).toHaveLength(2);
    expect(metadataOf(0).capi_consent).toBeUndefined();
    expect(metadataOf(1).capi_consent).toBe("1");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("scenario 2: the resume playhead in the return URL — two tabs on one episode, ten seconds apart", async () => {
    await createAuthCheckoutSession({ ...INPUT, resume: "128" });
    await createAuthCheckoutSession({ ...INPUT, resume: "138" });

    // The return URLs really differ — the old key hashed them.
    expect(st.sessions[0].params.return_url).toContain("resume=128");
    expect(st.sessions[1].params.return_url).toContain("resume=138");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("scenario 3: the wallet button and /checkout — paying by card closes the Apple Pay session left mounted in the other tab", async () => {
    const wallet = await createAuthWalletCheckoutSession(INPUT, true);
    await createAuthCheckoutSession(INPUT);

    expect(wallet.kind === "wallet" && wallet.sessionId).toBe("cs_test_1");
    expect(st.sessions[0].params.ui_mode).toBe("elements");
    expect(st.sessions[1].params.ui_mode).toBe("embedded_page");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("scenario 3, the other way round: ticking the wallet box closes a /checkout form open elsewhere", async () => {
    await createAuthCheckoutSession(INPUT);
    await createAuthWalletCheckoutSession(INPUT, true);

    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("scenario 4: two parallel FIRST checkouts get ONE Stripe customer, and the users row converges on it", async () => {
    // Both calls read the users row before either wrote a customer id back.
    // Without a deterministic idempotency key Stripe minted two customers and
    // the write-back was last-writer-wins: one session sat on a customer the
    // row no longer named — the webhook found no user, the cs= return refused
    // the mismatch, and the buyer had paid for nothing.
    h.userCustomerId = null;

    await Promise.all([
      createAuthCheckoutSession(INPUT),
      createAuthWalletCheckoutSession(INPUT, true),
    ]);

    expect(st.customersCreated).toBe(2);
    expect(st.customers).toHaveLength(1);
    expect(st.customers[0].idempotencyKey).toBe("customer:user_1");
    expect(new Set(st.sessions.map((s) => s.customer))).toEqual(
      new Set([st.customers[0].id]),
    );
    expect(h.userUpdates).toEqual([
      { stripeCustomerId: st.customers[0].id },
      { stripeCustomerId: st.customers[0].id },
    ]);
  });

  it("creating a session expires every OTHER open session of this customer — and only those", async () => {
    // Left over from earlier tabs: two open for this buyer, one open for
    // somebody else, one this buyer already completed.
    st.sessions = [
      { id: "cs_old_a", customer: "cus_existing", status: "open", params: {}, opts: undefined },
      { id: "cs_old_b", customer: "cus_existing", status: "open", params: {}, opts: undefined },
      { id: "cs_other", customer: "cus_other", status: "open", params: {}, opts: undefined },
      { id: "cs_done", customer: "cus_existing", status: "complete", params: {}, opts: undefined },
    ];

    const res = await createAuthCheckoutSession(INPUT);

    expect(res.kind).toBe("embedded");
    const byId = Object.fromEntries(st.sessions.map((s) => [s.id, s.status]));
    expect(byId).toEqual({
      cs_old_a: "expired",
      cs_old_b: "expired",
      cs_other: "open",
      cs_done: "complete",
      cs_test_5: "open",
    });
  });

  it("sweeps past the first page — a customer with more open sessions than one list returns", async () => {
    // Paged by re-listing: each expired session drops out of the `open`
    // result set, so the next first page surfaces what was behind it.
    st.listPageSize = 2;
    st.sessions = [
      { id: "cs_old_a", customer: "cus_existing", status: "open", params: {}, opts: undefined },
      { id: "cs_old_b", customer: "cus_existing", status: "open", params: {}, opts: undefined },
      { id: "cs_old_c", customer: "cus_existing", status: "open", params: {}, opts: undefined },
    ];

    const res = await createAuthCheckoutSession(INPUT);

    expect(res.kind).toBe("embedded");
    expect(openSessionIds()).toEqual(["cs_test_4"]);
    // Two pages of two: the first two olds (has_more), then — those two now
    // gone from the open set — the third old + the new one (last page).
    expect(st.listCalls).toBe(2);
  });

  it("the same intent in two tabs, seconds apart: the later tab holds the live session", async () => {
    // Previously both tabs shared one session through the idempotency key.
    // Now the newer creation wins; the older tab learns at confirm / refocus
    // and retries. Either way one session can take money, never two.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:30:00.000Z"));
    await createAuthWalletCheckoutSession(INPUT, true);
    vi.setSystemTime(new Date("2026-09-09T10:30:05.000Z"));
    const second = await createAuthWalletCheckoutSession(INPUT, true);
    vi.useRealTimers();

    expect(second.kind === "wallet" && second.sessionId).toBe("cs_test_2");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("never hands out a session it could not prove to be the only open one — the sweep failing closes the new session and throws", async () => {
    st.sessions = [
      { id: "cs_old", customer: "cus_existing", status: "open", params: {}, opts: undefined },
    ];
    st.fault = { on: "list" };

    await expect(createAuthCheckoutSession(INPUT)).rejects.toThrow(
      "stripe list down",
    );

    // Fail closed on the money path: the new session is expired before the
    // error leaves, so no client secret and no live second session exist.
    expect(st.sessions.find((s) => s.id === "cs_test_2")?.status).toBe("expired");
    expect(h.capiEvents).toHaveLength(0);
  });

  it("an expire that fails while the other session is STILL open is a failure, not a shrug", async () => {
    st.sessions = [
      { id: "cs_old", customer: "cus_existing", status: "open", params: {}, opts: undefined },
    ];
    st.fault = { on: "expire", then: "still_open" };

    await expect(createAuthWalletCheckoutSession(INPUT, true)).rejects.toThrow(
      "stripe expire failed",
    );

    expect(st.sessions.find((s) => s.id === "cs_test_2")?.status).toBe("expired");
  });

  it("an expire that fails because somebody else already closed that session is fine", async () => {
    // A parallel sweep, or the buyer completing it in the other tab a moment
    // earlier — the state the sweep wanted is already there.
    st.sessions = [
      { id: "cs_old", customer: "cus_existing", status: "open", params: {}, opts: undefined },
    ];
    st.fault = { on: "expire", then: "closed_by_other" };

    const res = await createAuthWalletCheckoutSession(INPUT, true);

    expect(res.kind).toBe("wallet");
    expect(openSessionIds()).toEqual(["cs_test_2"]);
  });

  it("uses no idempotency key on the create — a replay would hand out a session the sweep has since expired", async () => {
    // Stripe replays the CACHED first response for a repeated key, `status:
    // 'open'` included, with no way to tell from the response. Wallet →
    // /checkout → wallet again inside one hour: with the old key the third
    // call would get session 1 back — expired by the second call — and every
    // retry for the rest of the hour would get it again. The guard against
    // "let's add the key back".
    const first = await createAuthWalletCheckoutSession(INPUT, true);
    await createAuthCheckoutSession(INPUT);
    const third = await createAuthWalletCheckoutSession(INPUT, true);

    expect(st.sessions.every((s) => s.opts?.idempotencyKey === undefined)).toBe(
      true,
    );
    expect(first.kind === "wallet" && first.sessionId).toBe("cs_test_1");
    expect(third.kind === "wallet" && third.sessionId).toBe("cs_test_3");
    expect(openSessionIds()).toEqual(["cs_test_3"]);
  });
});

describe("reportWalletCheckoutStarted", () => {
  beforeEach(() => {
    h.selects = [[{ email: "buyer@example.test" }]];
  });

  it("reports InitiateCheckout and checkout_started keyed on the session id", async () => {
    await reportWalletCheckoutStarted("cs_test_created");

    expect(h.capiEvents).toEqual([
      expect.objectContaining({
        eventName: "InitiateCheckout",
        eventId: "cs_test_created",
      }),
    ]);
    expect(h.posthogEvents).toEqual([
      expect.objectContaining({ event: "checkout_started", distinctId: "user_1" }),
    ]);
  });

  it("ignores a session id that is not shaped like one", async () => {
    // The id becomes a Meta event id; a caller-supplied string is shape-checked
    // before it can pollute the ad account's dedup keyspace.
    await reportWalletCheckoutStarted("<script>");

    expect(h.capiEvents).toHaveLength(0);
    expect(h.posthogEvents).toHaveLength(0);
  });

  it("stays silent without marketing consent", async () => {
    h.consentCookie = undefined;

    await reportWalletCheckoutStarted("cs_test_created");

    expect(h.capiEvents).toHaveLength(0);
    expect(h.posthogEvents).toHaveLength(0);
  });

  it("stays silent for an anonymous caller", async () => {
    h.authUserId = null;

    await reportWalletCheckoutStarted("cs_test_created");

    expect(h.capiEvents).toHaveLength(0);
  });

  it("stays silent while payments are off", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");

    await reportWalletCheckoutStarted("cs_test_created");

    expect(h.capiEvents).toHaveLength(0);
  });

  it("still reports when the CAPI identity capture fails", async () => {
    // An identity capture failure degrades match quality; it must never take
    // the funnel event down with it.
    h.capiThrows = true;

    await reportWalletCheckoutStarted("cs_test_created");

    expect(h.posthogEvents).toHaveLength(1);
  });
});

// The /checkout form's builder shares prepareAuthCheckout with the wallet
// surface since #210. These are the regression guard on that refactor: the
// pre-existing flow must be unchanged in what it sells, where it returns, and
// what it reports.
describe("createAuthCheckoutSession — unchanged by the wallet refactor", () => {
  it("still builds an embedded_page session with the consent pair intact", async () => {
    const res = await createAuthCheckoutSession(INPUT);

    const { params } = st.sessions[0];
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.consent_collection).toEqual({ terms_of_service: "required" });
    expect(params.custom_text).toBeTruthy();
    // The session id rides along so the /checkout tab can ask whether its
    // session is still open when it comes back into view (#217).
    expect(res).toEqual({
      kind: "embedded",
      clientSecret: "cs_test_1_secret",
      sessionId: "cs_test_1",
    });
  });

  it("still returns to the watch path with Stripe's own placeholder", async () => {
    await createAuthCheckoutSession(INPUT);

    // Here Stripe substitutes the id on the redirect back; only the wallet
    // surface bakes it in itself.
    expect(st.sessions[0].params.return_url).toBe(
      "https://matio.tv/watch/the-scarlet-oath?ep=ep-3&resume=128&cs={CHECKOUT_SESSION_ID}",
    );
  });

  it("still falls back to a hosted session inside a webview", async () => {
    // The embedded iframe and the wallets are flaky in FB/IG webviews, so
    // those buyers get the full Stripe page — with success_url/cancel_url,
    // which embedded mode rejects.
    h.userAgent = "Mozilla/5.0 (iPhone) FBAN/FBIOS";

    const res = await createAuthCheckoutSession(INPUT);

    const { params } = st.sessions[0];
    expect(params.ui_mode).toBeUndefined();
    expect(params.success_url).toContain("/watch/the-scarlet-oath");
    expect(params.cancel_url).toContain("/subscribe?show=the-scarlet-oath");
    expect(res).toEqual({
      kind: "hosted",
      url: "https://checkout.stripe.com/cs_test_1",
    });
  });

  it("still fires the checkout-intent signals at creation", async () => {
    // Unlike the wallet surface: /checkout is reached by an intentful click,
    // so creation IS the intent moment there. Moving these would silently
    // change what the saved funnels measure.
    await createAuthCheckoutSession(INPUT);

    expect(h.capiEvents).toEqual([
      expect.objectContaining({
        eventName: "InitiateCheckout",
        eventId: "cs_test_1",
      }),
    ]);
    expect(h.posthogEvents).toEqual([
      expect.objectContaining({ event: "checkout_started" }),
    ]);
  });

  it("still honours the payments kill-switch", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");

    expect(await createAuthCheckoutSession(INPUT)).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(st.sessions).toHaveLength(0);
  });

  it("creates the Stripe customer and writes it back when the user has none", async () => {
    h.userCustomerId = null;

    await createAuthCheckoutSession(INPUT);

    // Without the write-back the webhook cannot resolve the local user — it
    // looks up ONLY by users.stripe_customer_id — and a paying customer
    // silently gets nothing.
    expect(st.customersCreated).toBe(1);
    expect(st.sessions[0].params.customer).toBe("cus_new_1");
    expect(h.userUpdates).toEqual([{ stripeCustomerId: "cus_new_1" }]);
  });

  it("survives an analytics outage without blocking the sale", async () => {
    const { sendCapiEvents } = await import("@/lib/meta-capi");
    vi.mocked(sendCapiEvents).mockRejectedValueOnce(new Error("meta down"));

    const res = await createAuthCheckoutSession(INPUT);

    expect(res.kind).toBe("embedded");
  });
});
