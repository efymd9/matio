// A STATEFUL fake of the Stripe surface the checkout builders touch — shared
// by app/subscribe/wallet-actions.test.ts (signed-in, #217) and
// app/subscribe/guest-actions.test.ts (pay-first guest, #224), so the two
// suites cannot drift in what "Stripe" means. Lives under tools/ like the Lab's
// test shim: test scaffolding, outside the coverage measurement.
//
// Stateful because the one-open-session invariant is about lifecycle: a
// session is created open, `list` filters by customer + status the way the
// real endpoint does, `expire` flips an open session and refuses a closed one,
// `retrieve` reads the current status, `customers.create` honours an
// idempotency key, and `checkout.sessions.create` replays the CACHED first
// response for a repeated key — exactly the Stripe semantics that made an
// hour-bucketed key unsafe next to the sweep.
//
// Not a vitest module on purpose (no vi.* here): a test file hands the
// `stripe` object to its own `vi.mock("@/lib/stripe", …)` and reads / seeds
// `state` directly.

export type FakeSession = {
  id: string;
  customer: string | undefined;
  status: "open" | "expired" | "complete";
  params: Record<string, unknown>;
  opts: { idempotencyKey?: string } | undefined;
};

// One-shot fault injection for a sweep: `list` throws; `expire` throws and
// either leaves the session open (transient) or marks it closed first
// (somebody else got there — a parallel sweep, or the buyer paying).
export type FakeFault =
  | null
  | { on: "list" }
  | { on: "expire"; then: "still_open" | "closed_by_other" };

export type StripeFakeState = {
  sessions: FakeSession[];
  customers: Array<{ id: string; idempotencyKey?: string }>;
  customersCreated: number;
  stripeSubs: Array<{ status: string }>;
  fault: FakeFault;
  // Page size of the fake `list` — Stripe's `limit` is honoured and
  // `has_more` set like the real endpoint, so a sweep's paging is real.
  listPageSize: number;
  listCalls: number;
  // Every `expire` asked for, in order — including the ones refused.
  expireCalls: string[];
};

function sessionResponse(s: FakeSession) {
  return {
    id: s.id,
    status: s.status,
    client_secret: `${s.id}_secret`,
    url: `https://checkout.stripe.com/${s.id}`,
  };
}

export function createStripeCheckoutFake() {
  const state: StripeFakeState = {
    sessions: [],
    customers: [],
    customersCreated: 0,
    stripeSubs: [],
    fault: null,
    listPageSize: 100,
    listCalls: 0,
    expireCalls: [],
  };

  const reset = () => {
    state.sessions = [];
    state.customers = [];
    state.customersCreated = 0;
    state.stripeSubs = [];
    state.fault = null;
    state.listPageSize = 100;
    state.listCalls = 0;
    state.expireCalls = [];
  };

  const stripe = {
    customers: {
      create: async (
        _params: Record<string, unknown>,
        opts?: { idempotencyKey?: string },
      ) => {
        state.customersCreated += 1;
        const key = opts?.idempotencyKey;
        const replay = key
          ? state.customers.find((c) => c.idempotencyKey === key)
          : undefined;
        if (replay) return { id: replay.id };
        const id = `cus_new_${state.customers.length + 1}`;
        state.customers.push({ id, idempotencyKey: key });
        return { id };
      },
    },
    subscriptions: { list: async () => ({ data: state.stripeSubs }) },
    checkout: {
      sessions: {
        create: async (
          params: Record<string, unknown>,
          opts?: { idempotencyKey?: string },
        ) => {
          const key = opts?.idempotencyKey;
          const replay = key
            ? state.sessions.find((s) => s.opts?.idempotencyKey === key)
            : undefined;
          // Stripe replays the response it CACHED for the first request —
          // including a `status: 'open'` that may no longer be true.
          if (replay) return sessionResponse({ ...replay, status: "open" });
          const s: FakeSession = {
            id: `cs_test_${state.sessions.length + 1}`,
            customer: params.customer as string | undefined,
            status: "open",
            params,
            opts,
          };
          state.sessions.push(s);
          return sessionResponse(s);
        },
        list: async ({
          customer,
          status,
          limit,
        }: {
          customer?: string;
          status?: string;
          limit?: number;
        }) => {
          state.listCalls += 1;
          if (state.fault?.on === "list") {
            state.fault = null;
            throw new Error("stripe list down");
          }
          const matching = state.sessions.filter(
            (s) => s.customer === customer && (!status || s.status === status),
          );
          const pageSize = Math.min(limit ?? 10, state.listPageSize);
          return {
            data: matching
              .slice(0, pageSize)
              .map((s) => ({ id: s.id, status: s.status })),
            has_more: matching.length > pageSize,
          };
        },
        expire: async (id: string) => {
          state.expireCalls.push(id);
          const s = state.sessions.find((x) => x.id === id);
          if (state.fault?.on === "expire") {
            const fault = state.fault;
            state.fault = null;
            if (fault.then === "closed_by_other" && s) s.status = "complete";
            throw new Error("stripe expire failed");
          }
          if (!s || s.status !== "open") {
            throw new Error("You cannot expire a Checkout Session that is not open");
          }
          s.status = "expired";
          return { id, status: "expired" };
        },
        retrieve: async (id: string) => {
          const s = state.sessions.find((x) => x.id === id);
          if (!s) throw new Error("No such checkout.session");
          return { id, status: s.status };
        },
      },
    },
  };

  return { state, stripe, reset };
}
