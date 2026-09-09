import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The paywall's in-place wallet checkout (#210). The subject here is the glue
// the pure rules cannot cover: which Stripe call is made (or, more often, NOT
// made), what lands in the Checkout Session, and what the buyer's browser is
// handed back. The gate table itself is pinned in lib/wallet-checkout.test.ts;
// the two-surface parity is pinned in lib/checkout-session-params.test.ts.
//
// The db is the queue-driven fake used by the admin action suites: each
// db.select() resolves to the next queued result.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  sessions: [] as Array<{ params: Record<string, unknown>; opts: unknown }>,
  stripeSubs: [] as Array<{ status: string }>,
  customersCreated: 0,
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
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

vi.mock("@/lib/admin", () => ({
  getOrSyncCurrentUser: vi.fn(async () =>
    h.authUserId
      ? {
          id: h.authUserId,
          email: "buyer@example.test",
          stripeCustomerId: "cus_existing",
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

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    customers: {
      create: async () => {
        h.customersCreated += 1;
        return { id: "cus_new" };
      },
    },
    subscriptions: { list: async () => ({ data: h.stripeSubs }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, opts: unknown) => {
          h.sessions.push({ params, opts });
          return {
            id: "cs_test_created",
            client_secret: "cs_secret_x",
            url: "https://checkout.stripe.com/x",
          };
        },
      },
    },
  }),
}));

vi.mock("@/lib/checkout-target", () => ({
  resolveCheckoutTarget: async () => ({
    showSlug: "the-scarlet-oath",
    episodeId: "ep-3",
    resume: "128",
  }),
  buildWatchPath: () => "/watch/the-scarlet-oath?ep=ep-3&resume=128",
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

beforeEach(() => {
  h.selects = [[]];
  h.sessions = [];
  h.stripeSubs = [];
  h.customersCreated = 0;
  h.userAgent = "Mozilla/5.0 (iPhone) Safari";
  h.consentCookie = serializeConsent({
    necessary: true,
    marketing: true,
    ts: 0,
    v: CONSENT_VERSION,
  });
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
    expect(h.sessions).toHaveLength(0);
  });

  it("is unavailable — and silent — with the kill-switch unset", async () => {
    vi.stubEnv("WALLET_EXPRESS_CHECKOUT", "");

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(h.sessions).toHaveLength(0);
  });

  it("is unavailable with no publishable key — a dead slot is worse than none", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "");

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(h.sessions).toHaveLength(0);
  });

  it("is unavailable inside the Instagram webview", async () => {
    // Google Pay cannot render in an iOS webview at all, and the sheet is
    // unreliable in Android's — ~60% of ad traffic lands here.
    h.userAgent = "Mozilla/5.0 (iPhone) Instagram 300.0";

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(h.sessions).toHaveLength(0);
  });

  it("is unavailable for an anonymous buyer in v1", async () => {
    h.authUserId = null;

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "unavailable",
    });
    expect(h.sessions).toHaveLength(0);
  });

  it("refuses to sell without the withdrawal waiver", async () => {
    // Stripe cannot collect it on this surface, so an unticked box arriving
    // here means the client was bypassed — not that the buyer consented.
    expect(await createAuthWalletCheckoutSession(INPUT, false)).toEqual({
      kind: "unavailable",
    });
    expect(h.sessions).toHaveLength(0);
  });

  it("redirects a buyer who already holds an access-granting row", async () => {
    h.selects = [[{ id: "sub_existing" }]];

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(h.sessions).toHaveLength(0);
  });

  it("redirects when Stripe itself still shows a live subscription", async () => {
    // The DB mirror can lag behind an in-flight webhook; Stripe is the
    // source of truth, and a double-tap here is a second $25/mo charge.
    h.stripeSubs = [{ status: "active" }];

    expect(await createAuthWalletCheckoutSession(INPUT, true)).toEqual({
      kind: "redirect",
      to: "/",
    });
    expect(h.sessions).toHaveLength(0);
  });
});

describe("createAuthWalletCheckoutSession — the session it builds", () => {
  it("creates an elements-mode subscription session for the membership price", async () => {
    const res = await createAuthWalletCheckoutSession(INPUT, true);

    const { params } = h.sessions[0];
    expect(params.ui_mode).toBe("elements");
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price: "price_monthly", quantity: 1 },
    ]);
    expect(res.kind).toBe("wallet");
  });

  it("keeps tax and address collection — renewals must invoice correctly", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const { params } = h.sessions[0];
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    expect(params.customer).toBe("cus_existing");
  });

  it("omits the consent params Stripe rejects on this ui_mode", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    // `custom_text` is a hard 400 here and `consent_collection` has no
    // renderer — the waiver moved into our own checkbox instead.
    const { params } = h.sessions[0];
    expect(params.custom_text).toBeUndefined();
    expect(params.consent_collection).toBeUndefined();
  });

  it("records the waiver acceptance on the subscription metadata", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const meta = (
      h.sessions[0].params.subscription_data as { metadata: Record<string, string> }
    ).metadata;
    expect(meta.tos_version).toBe("2026-08-16");
    expect(() => new Date(meta.tos_accepted_at).toISOString()).not.toThrow();
  });

  it("carries the whole metadata channel the cookie-less webhook depends on", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const meta = (
      h.sessions[0].params.subscription_data as { metadata: Record<string, string> }
    ).metadata;
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
      clientSecret: "cs_secret_x",
      sessionId: "cs_test_created",
    });
    expect(res.kind === "wallet" && res.returnUrl).toContain(
      "cs=cs_test_created",
    );
    expect(res.kind === "wallet" && res.returnUrl).not.toContain(
      "CHECKOUT_SESSION_ID",
    );
  });

  it("keys idempotency on the elements surface, so it cannot collide /checkout", async () => {
    await createAuthWalletCheckoutSession(INPUT, true);

    const key = (h.sessions[0].opts as { idempotencyKey: string }).idempotencyKey;
    expect(key).toMatch(/^checkout:user_1:\d+:[0-9a-f]{16}$/);
  });

  // The two tabs are SECONDS apart, not microseconds. Without the clock being
  // moved between the calls both assertions below pass even against the bug
  // they exist to catch — two `new Date()` reads inside the same millisecond
  // produce the same string. Mid-hour start so advancing cannot cross a bucket
  // boundary and make the suite flaky.
  async function twoTabsFiveSecondsApart() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T10:30:00.000Z"));
    await createAuthWalletCheckoutSession(INPUT, true);
    vi.setSystemTime(new Date("2026-09-09T10:30:05.000Z"));
    await createAuthWalletCheckoutSession(INPUT, true);
    vi.useRealTimers();
  }

  it("produces the SAME idempotency key for the same intent — the double-charge guard", async () => {
    // The key only protects anything if it is stable. An earlier revision
    // stamped the waiver acceptance with `new Date()` and hashed it into the
    // variant digest, so every call minted a fresh key: two tabs would create
    // two live sessions and a buyer who confirmed in both paid twice.
    await twoTabsFiveSecondsApart();

    const [a, b] = h.sessions.map(
      (s) => (s.opts as { idempotencyKey: string }).idempotencyKey,
    );
    expect(a).toBe(b);
  });

  it("sends byte-identical create params on that repeat, or Stripe 400s the replay", async () => {
    // The other half of the same guard: a stable key with drifting params is
    // `idempotency_error`, which dead-ends checkout until the hour rolls.
    await twoTabsFiveSecondsApart();

    expect(JSON.stringify(h.sessions[0].params)).toBe(
      JSON.stringify(h.sessions[1].params),
    );
  });

  it("still records a real, parseable acceptance instant", async () => {
    // Hour-bucketed, not fabricated: it must remain a timestamp that precedes
    // the subscription it justifies.
    await createAuthWalletCheckoutSession(INPUT, true);

    const meta = (
      h.sessions[0].params.subscription_data as { metadata: Record<string, string> }
    ).metadata;
    const at = new Date(meta.tos_accepted_at).getTime();
    expect(Number.isNaN(at)).toBe(false);
    expect(at).toBeLessThanOrEqual(Date.now());
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

    const meta = (
      h.sessions[0].params.subscription_data as { metadata: Record<string, string> }
    ).metadata;
    expect(meta.capi_consent).toBeUndefined();
    expect(meta.ph_consent).toBeUndefined();
    expect(meta.tos_accepted_at).toBeTruthy();
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

    const { params } = h.sessions[0];
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.consent_collection).toEqual({ terms_of_service: "required" });
    expect(params.custom_text).toBeTruthy();
    expect(res).toEqual({ kind: "embedded", clientSecret: "cs_secret_x" });
  });

  it("still returns to the watch path with Stripe's own placeholder", async () => {
    await createAuthCheckoutSession(INPUT);

    // Here Stripe substitutes the id on the redirect back; only the wallet
    // surface bakes it in itself.
    expect(h.sessions[0].params.return_url).toBe(
      "https://matio.tv/watch/the-scarlet-oath?ep=ep-3&resume=128&cs={CHECKOUT_SESSION_ID}",
    );
  });

  it("still falls back to a hosted session inside a webview", async () => {
    // The embedded iframe and the wallets are flaky in FB/IG webviews, so
    // those buyers get the full Stripe page — with success_url/cancel_url,
    // which embedded mode rejects.
    h.userAgent = "Mozilla/5.0 (iPhone) FBAN/FBIOS";

    const res = await createAuthCheckoutSession(INPUT);

    const { params } = h.sessions[0];
    expect(params.ui_mode).toBeUndefined();
    expect(params.success_url).toContain("/watch/the-scarlet-oath");
    expect(params.cancel_url).toContain("/subscribe?show=the-scarlet-oath");
    expect(res).toEqual({
      kind: "hosted",
      url: "https://checkout.stripe.com/x",
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
        eventId: "cs_test_created",
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
    expect(h.sessions).toHaveLength(0);
  });

  it("creates the Stripe customer and writes it back when the user has none", async () => {
    const { getOrSyncCurrentUser } = await import("@/lib/admin");
    vi.mocked(getOrSyncCurrentUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.test",
      stripeCustomerId: null,
    } as never);

    await createAuthCheckoutSession(INPUT);

    // Without the write-back the webhook cannot resolve the local user — it
    // looks up ONLY by users.stripe_customer_id — and a paying customer
    // silently gets nothing.
    expect(h.customersCreated).toBe(1);
    expect(h.sessions[0].params.customer).toBe("cus_new");
  });

  it("survives an analytics outage without blocking the sale", async () => {
    const { sendCapiEvents } = await import("@/lib/meta-capi");
    vi.mocked(sendCapiEvents).mockRejectedValueOnce(new Error("meta down"));

    const res = await createAuthCheckoutSession(INPUT);

    expect(res.kind).toBe("embedded");
  });
});
