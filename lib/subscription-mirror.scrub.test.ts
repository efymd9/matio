import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The database is faked at the query-builder boundary; the Drizzle schema is
// real, so the two SELECTs the mirror issues are routed by table name. Every
// vendor call (Stripe, Meta, PostHog) is a spy. What is under test is the
// minimisation contract around the Purchase event (#165): the four CAPI match
// signals are erased from the subscription's metadata at Stripe exactly once
// the event can no longer use them — and never before.
const h = vi.hoisted(() => ({
  userRow: undefined as { id: string; email: string } | undefined,
  priorRow: undefined as { status: string } | undefined,
  upserts: [] as { table: string; values: Record<string, unknown> }[],
  stripeUpdate: vi.fn(),
  sendCapi: vi.fn(),
  capture: vi.fn(),
  markConverted: vi.fn(),
  claimGuest: vi.fn(),
}));

vi.mock("@/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  type Table = Parameters<typeof getTableName>[0];
  return {
    db: {
      select: () => ({
        from: (table: Table) => ({
          where: () => ({
            limit: async () => {
              const name = getTableName(table);
              if (name === "users") return h.userRow ? [h.userRow] : [];
              if (name === "subscriptions") return h.priorRow ? [h.priorRow] : [];
              throw new Error(`unexpected select from ${name}`);
            },
          }),
        }),
      }),
      insert: (table: Table) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => {
            h.upserts.push({ table: getTableName(table), values });
          },
        }),
      }),
    },
  };
});
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { update: h.stripeUpdate } }),
}));
vi.mock("@/lib/meta-capi", () => ({ sendCapiEvents: h.sendCapi }));
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvent: h.capture,
  metadataHasPosthogConsent: (m: Record<string, string> | null | undefined) =>
    (m ?? {}).ph_consent === "1",
}));
vi.mock("@/lib/trial", () => ({ markUserTrialsConverted: h.markConverted }));
vi.mock("@/lib/guest-checkout", () => ({
  isGuestSubscription: (sub: { metadata?: Record<string, string> }) =>
    (sub.metadata ?? {}).guest === "1",
  claimGuestCheckout: h.claimGuest,
}));

import { mirrorSubscription } from "./subscription-mirror";

const PRICE_MONTHLY = "price_monthly_dummy";
const SUB_ID = "sub_1";

// What startCheckout writes with marketing consent: the sentinel plus the
// four match signals. Obviously fake values.
const IDENTITY = {
  capi_consent: "1",
  capi_fbp: "fb.1.1700000000000.1234567890",
  capi_fbc: "fb.1.1700000000000.IwAR0dummy",
  capi_ip: "203.0.113.7",
  capi_ua: "Mozilla/5.0 (dummy)",
};
// The patch that erases them: "" deletes a key at Stripe. The sentinel is
// deliberately NOT in it.
const SCRUB = { capi_fbp: "", capi_fbc: "", capi_ip: "", capi_ua: "" };

function stripeSub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: SUB_ID,
    customer: "cus_1",
    status: "active",
    trial_start: null,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: {},
    items: {
      data: [
        {
          price: { id: PRICE_MONTHLY, unit_amount: 3800, currency: "usd" },
          current_period_end: 1_900_000_000,
        },
      ],
    },
    ...over,
  } as unknown as Stripe.Subscription;
}

beforeEach(() => {
  vi.stubEnv("STRIPE_PRICE_MONTHLY", PRICE_MONTHLY);
  h.userRow = { id: "user_1", email: "buyer@example.invalid" };
  h.priorRow = undefined;
  h.upserts.length = 0;
  h.stripeUpdate.mockReset().mockResolvedValue({});
  h.sendCapi.mockReset().mockResolvedValue({ ok: true });
  h.capture.mockReset().mockResolvedValue({ ok: true });
  h.markConverted.mockReset().mockResolvedValue(undefined);
  h.claimGuest.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mirrorSubscription · CAPI identity scrub (#165)", () => {
  it("first access-granting mirror: fires Purchase from the snapshot, THEN erases the four keys", async () => {
    await mirrorSubscription(stripeSub({ metadata: IDENTITY }));

    // The event got the raw signals it exists for…
    expect(h.sendCapi).toHaveBeenCalledTimes(1);
    const [events] = h.sendCapi.mock.calls[0];
    expect(events[0]).toMatchObject({
      eventName: "Purchase",
      eventId: SUB_ID,
      user: {
        fbp: IDENTITY.capi_fbp,
        fbc: IDENTITY.capi_fbc,
        clientIpAddress: IDENTITY.capi_ip,
        clientUserAgent: IDENTITY.capi_ua,
      },
    });
    // …and only after that were they erased — exactly once, sentinel kept.
    expect(h.stripeUpdate).toHaveBeenCalledTimes(1);
    expect(h.stripeUpdate).toHaveBeenCalledWith(SUB_ID, { metadata: SCRUB });
    expect(h.stripeUpdate.mock.calls[0][1].metadata).not.toHaveProperty(
      "capi_consent",
    );
    expect(h.sendCapi.mock.invocationCallOrder[0]).toBeLessThan(
      h.stripeUpdate.mock.invocationCallOrder[0],
    );
    // The money path was written before the vendor call.
    expect(h.upserts).toEqual([
      expect.objectContaining({
        table: "subscriptions",
        values: expect.objectContaining({ status: "active", plan: "monthly" }),
      }),
    ]);
    expect(h.markConverted).toHaveBeenCalledWith("user_1");
  });

  it("a genuine renewal (row already access-granting, keys already gone) touches neither Meta nor Stripe", async () => {
    h.priorRow = { status: "active" };

    await mirrorSubscription(stripeSub({ metadata: { capi_consent: "1" } }));

    expect(h.sendCapi).not.toHaveBeenCalled();
    expect(h.stripeUpdate).not.toHaveBeenCalled();
    expect(h.upserts).toHaveLength(1); // the mirror itself still ran
  });

  it("a redelivered payload that still carries the keys is erased again — without a second Purchase", async () => {
    // Stripe event payloads are snapshots: customer.subscription.created can
    // arrive after checkout.session.completed already fired and scrubbed.
    // Also the self-healing path when the first scrub failed at Stripe.
    h.priorRow = { status: "trialing" };

    await mirrorSubscription(stripeSub({ metadata: IDENTITY }));

    expect(h.sendCapi).not.toHaveBeenCalled();
    expect(h.stripeUpdate).toHaveBeenCalledTimes(1);
    expect(h.stripeUpdate).toHaveBeenCalledWith(SUB_ID, { metadata: SCRUB });
  });

  it("a Stripe failure during the scrub never fails the mirror, and is logged by id only", async () => {
    h.stripeUpdate.mockRejectedValue(
      Object.assign(new Error("No such subscription"), {
        name: "StripeInvalidRequestError",
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      mirrorSubscription(stripeSub({ metadata: IDENTITY })),
    ).resolves.toBeUndefined();

    expect(h.sendCapi).toHaveBeenCalledTimes(1);
    expect(h.markConverted).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toEqual({
      subId: SUB_ID,
      error: "StripeInvalidRequestError",
    });
  });

  it("a subscription still on its way to access (incomplete) keeps its keys — the Purchase is still ahead", async () => {
    await mirrorSubscription(stripeSub({ status: "incomplete", metadata: IDENTITY }));

    expect(h.sendCapi).not.toHaveBeenCalled();
    expect(h.stripeUpdate).not.toHaveBeenCalled();
    expect(h.upserts[0].values).toMatchObject({ status: "canceled" });
  });

  it.each(["canceled", "incomplete_expired"] as const)(
    "a terminal subscription (%s) that never granted access is erased anyway — no Purchase can come",
    async (status) => {
      await mirrorSubscription(stripeSub({ status, metadata: IDENTITY }));

      expect(h.sendCapi).not.toHaveBeenCalled();
      expect(h.stripeUpdate).toHaveBeenCalledTimes(1);
      expect(h.stripeUpdate).toHaveBeenCalledWith(SUB_ID, { metadata: SCRUB });
    },
  );

  it("without marketing consent there is nothing to fire and nothing to erase", async () => {
    await mirrorSubscription(stripeSub({ metadata: {} }));

    expect(h.sendCapi).not.toHaveBeenCalled();
    expect(h.stripeUpdate).not.toHaveBeenCalled();
    expect(h.upserts).toHaveLength(1);
  });

  it("consent with an empty snapshot fires the Purchase and skips the scrub — nothing to erase", async () => {
    await mirrorSubscription(stripeSub({ metadata: { capi_consent: "1" } }));

    expect(h.sendCapi).toHaveBeenCalledTimes(1);
    expect(h.stripeUpdate).not.toHaveBeenCalled();
  });
});
