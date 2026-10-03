import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// linkTrialSessionsToCurrentUser (#349): the signed-in render attaches
// anonymous trial_sessions rows to the account — by the browser's own cookie
// (an exact-token proof) and, as a fallback, by a recent row from the same
// IP-hash bucket (an ad webview that drops cookies mints many rows under many
// tokens). The fallback is a guess by NETWORK, and the app's device rows must
// stay out of it: nothing ties a device to this browser, and behind a carrier
// CGNAT the same-IP match would hand a stranger's phone to this account — out
// of the retention cron's reach and into the art. 15 export.
//
// The query is the subject, so it runs: drizzle's operators are replaced by a
// plain AST and a ten-line evaluator applies the condition `linkTrialSessions…`
// really built to in-memory rows — with SQL's three-valued rule that a
// comparison against NULL is never true.
type Node =
  | { op: "and" | "or"; args: Node[] }
  | { op: "eq" | "gt"; col: string; val: unknown }
  | { op: "isNull"; col: string };

type Row = {
  id: string;
  sessionToken: string;
  ipHash: string | null;
  startedAt: Date;
  userId: string | null;
  client: "web" | "app" | null;
};

function holds(n: Node, row: Row): boolean {
  switch (n.op) {
    case "and":
      return n.args.every((a) => holds(a, row));
    case "or":
      return n.args.some((a) => holds(a, row));
    case "eq": {
      const v = row[n.col as keyof Row];
      return v != null && v === n.val;
    }
    case "gt": {
      const v = row[n.col as keyof Row];
      return v != null && (v as Date) > (n.val as Date);
    }
    case "isNull":
      return row[n.col as keyof Row] == null;
  }
}

const h = vi.hoisted(() => ({
  userId: "user_1" as string | null,
  mirror: true,
  cookie: undefined as string | undefined,
  clientIp: "203.0.113.7",
  rows: [] as Row[],
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: h.userId }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "trial_session" && h.cookie ? { value: h.cookie } : undefined,
  }),
  headers: async () =>
    new Headers(h.clientIp ? { "x-vercel-forwarded-for": h.clientIp } : {}),
}));
vi.mock("@/db/schema", () => ({
  trialSessions: {
    sessionToken: "sessionToken",
    ipHash: "ipHash",
    startedAt: "startedAt",
    userId: "userId",
    client: "client",
  },
  users: { id: "id" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: Node[]) => ({ op: "and", args }),
  or: (...args: Node[]) => ({ op: "or", args }),
  eq: (col: string, val: unknown) => ({ op: "eq", col, val }),
  gt: (col: string, val: unknown) => ({ op: "gt", col, val }),
  isNull: (col: string) => ({ op: "isNull", col }),
  count: () => "count",
}));
vi.mock("@/lib/attribution", () => ({
  EMPTY_ATTRIBUTION: {},
  toFirstColumns: () => ({}),
  toLastColumns: () => ({}),
}));
vi.mock("@/db", () => ({
  db: {
    // The users-mirror probe: select().from().where().limit().
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (h.mirror ? [{ id: h.userId }] : []) }),
      }),
    }),
    update: () => ({
      set: (values: { userId: string }) => ({
        where: async (cond: Node) => {
          for (const row of h.rows) if (holds(cond, row)) Object.assign(row, values);
        },
      }),
    }),
  },
}));

import { hashClientIp, linkTrialSessionsToCurrentUser } from "./trial";

const HOUR = 60 * 60 * 1000;
// Both session_token shapes are a random canonical UUID — the web cookie
// (crypto.randomUUID() in /api/playback-token) and the app's device id
// (Crypto.randomUUID()) — which is why the token cannot tell them apart.
const WEB_COOKIE = "1eaf0000-dead-4bee-8f00-00000000beef";
const WEB_OTHER = "2b0b0000-dead-4bee-8f00-0000000000a1";
const DEVICE = "9c858901-8a57-4791-81fe-4c455b099bc9";

function row(over: Partial<Row> & Pick<Row, "sessionToken">): Row {
  const r: Row = {
    id: `row-${h.rows.length + 1}`,
    ipHash: hashClientIp(h.clientIp),
    startedAt: new Date(Date.now() - HOUR),
    userId: null,
    client: "web",
    ...over,
  };
  h.rows.push(r);
  return r;
}

beforeEach(() => {
  vi.stubEnv("MUX_SIGNING_KEY_PRIVATE_KEY", "sk-test-link-salt");
  h.userId = "user_1";
  h.mirror = true;
  h.cookie = undefined;
  h.clientIp = "203.0.113.7";
  h.rows = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("linkTrialSessionsToCurrentUser — the IP fallback and the app's device rows (#349)", () => {
  it("does NOT link a device row that shares the IP hash within the window", async () => {
    const device = row({ sessionToken: DEVICE, client: "app" });

    await linkTrialSessionsToCurrentUser();

    expect(device.userId).toBeNull();
  });

  it("still links a web row with the same IP hash — the ad-webview fallback", async () => {
    const web = row({ sessionToken: WEB_OTHER, client: "web" });

    await linkTrialSessionsToCurrentUser();

    expect(web.userId).toBe("user_1");
  });

  it("with both on one IP, claims the web row and leaves the device row", async () => {
    const device = row({ sessionToken: DEVICE, client: "app" });
    const web = row({ sessionToken: WEB_OTHER, client: "web" });

    await linkTrialSessionsToCurrentUser();

    expect([web.userId, device.userId]).toEqual(["user_1", null]);
  });

  it("links the row of the browser's own cookie as before — no IP involved", async () => {
    h.cookie = WEB_COOKIE;
    h.clientIp = "";
    const own = row({ sessionToken: WEB_COOKIE, client: "web", ipHash: null });
    // A legacy row (minted before the column) is still linkable BY COOKIE:
    // the exact-token proof never depended on knowing who minted it.
    const legacy = row({ sessionToken: WEB_COOKIE, client: null, ipHash: null });

    await linkTrialSessionsToCurrentUser();

    expect(own.userId).toBe("user_1");
    expect(legacy.userId).toBe("user_1");
  });

  it("leaves a legacy row (no client recorded) alone on the IP fallback", async () => {
    // Web or app is unknowable for it, so the fallback takes the privacy-safe
    // side; it stays cookie-linkable and ages out through the retention cron.
    const legacy = row({ sessionToken: WEB_OTHER, client: null });

    await linkTrialSessionsToCurrentUser();

    expect(legacy.userId).toBeNull();
  });

  it("keeps the fallback's other bounds: six hours, the same bucket, unlinked rows only", async () => {
    const stale = row({ sessionToken: WEB_OTHER, startedAt: new Date(Date.now() - 7 * HOUR) });
    const elsewhere = row({
      sessionToken: "3c0c0000-dead-4bee-8f00-0000000000b2",
      ipHash: hashClientIp("198.51.100.9"),
    });
    const taken = row({
      sessionToken: "4d0d0000-dead-4bee-8f00-0000000000c3",
      userId: "user_2",
    });

    await linkTrialSessionsToCurrentUser();

    expect(stale.userId).toBeNull();
    expect(elsewhere.userId).toBeNull();
    expect(taken.userId).toBe("user_2");
  });

  it("never links on the shared 'unknown' bucket", async () => {
    h.clientIp = "";
    const web = row({ sessionToken: WEB_OTHER, ipHash: hashClientIp("unknown") });

    await linkTrialSessionsToCurrentUser();

    expect(web.userId).toBeNull();
  });

  it("does nothing for an anonymous caller, or before the users mirror exists", async () => {
    const web = row({ sessionToken: WEB_OTHER });

    h.userId = null;
    await linkTrialSessionsToCurrentUser();
    h.userId = "user_1";
    h.mirror = false;
    await linkTrialSessionsToCurrentUser();

    expect(web.userId).toBeNull();
  });
});
