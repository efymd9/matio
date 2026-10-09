import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The app's «Delete account» (#309), through the REAL erasure
// (lib/erase-user.ts:eraseUser) down to a faked database that keeps state —
// the users row a DELETE removes is gone for the next call — so a retry and a
// later Clerk webhook meet the database the first request left behind. Clerk,
// Stripe and Sentry are spies. What a shipped binary depends on: who may
// delete, the order (our side before Clerk), and that every failure answers
// something a retry turns into success.
const h = vi.hoisted(() => ({
  userId: "user_2abc" as string | null,
  userRow: undefined as
    | { email: string; stripeCustomerId: string | null }
    | undefined,
  liveSub: undefined as { stripeSubscriptionId: string } | undefined,
  // Every write the handler caused, in order — the database's and Clerk's.
  writes: [] as string[],
  selects: 0,
  // The next DELETE FROM users throws, once — a database refusing mid-erasure.
  usersDeleteFails: false,
  // clerkClient() itself throws — @clerk/nextjs without a secret key.
  clerkClientFails: false,
  // Every read of `users` throws from now on — the database gone mid-request.
  usersSelectFails: false,
  clerkDelete: vi.fn(),
  // The account is gone at Clerk — set by a deleteUser that went through;
  // from then on Clerk answers 404 about it (the late user.created, #336).
  clerkGone: false,
  stripeUpdate: vi.fn(),
  stripeSearch: vi.fn(),
  sentryMessage: vi.fn(),
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
              h.selects += 1;
              const name = getTableName(table);
              if (name === "users" && h.usersSelectFails) {
                throw Object.assign(new Error("connection terminated"), {
                  name: "PostgresError",
                });
              }
              if (name === "users") return h.userRow ? [h.userRow] : [];
              if (name === "subscriptions") return h.liveSub ? [h.liveSub] : [];
              throw new Error(`unexpected select from ${name}`);
            },
          }),
        }),
      }),
      delete: (table: Table) => ({
        where: () => {
          const name = getTableName(table);
          if (name === "users" && h.usersDeleteFails) {
            h.usersDeleteFails = false;
            const refused = Object.assign(new Error("connection terminated"), {
              name: "PostgresError",
            });
            return Object.assign(Promise.reject(refused), {
              returning: async () => {
                throw refused;
              },
            });
          }
          h.writes.push(`delete ${name}`);
          if (name === "users") h.userRow = undefined;
          return Object.assign(Promise.resolve(undefined), {
            returning: async () => [],
          });
        },
      }),
      insert: (table: Table) => ({
        values: () => ({
          onConflictDoNothing: async () => {
            h.writes.push(`insert ${getTableName(table)}`);
          },
        }),
      }),
    },
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.userId }),
  clerkClient: async () => {
    if (h.clerkClientFails) throw new Error("Missing secretKey");
    return {
      users: {
        deleteUser: async (id: string) => {
          h.writes.push(`clerk deleteUser ${id}`);
          const deleted = await h.clerkDelete(id);
          h.clerkGone = true;
          return deleted;
        },
        getUser: async (id: string) => {
          if (h.clerkGone) {
            throw Object.assign(new Error("Not Found"), {
              name: "ClerkAPIResponseError",
              status: 404,
            });
          }
          return { id };
        },
      },
    };
  },
}));
// The follow-up `user.deleted` delivery: its signature check has its own
// suite (app/api/webhooks/clerk/route.test.ts); here the event is handed over
// verified.
vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: async (req: Request) => req.json(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    subscriptions: { update: h.stripeUpdate },
    customers: { search: h.stripeSearch },
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentryMessage }));

import { POST as clerkWebhook } from "@/app/api/webhooks/clerk/route";
import { POST } from "./route";

const USER_ID = "user_2abc";
const EMAIL = "someone@example.invalid";

function deleteRequest(
  headers: Record<string, string> = { authorization: "Bearer sess_dummy" },
): Parameters<typeof POST>[0] {
  return new Request("https://matio.tv/api/v1/account/delete", {
    method: "POST",
    headers,
  }) as unknown as Parameters<typeof POST>[0];
}

function clerkError(status: number) {
  return Object.assign(new Error(status === 404 ? "Not Found" : "Internal Server Error"), {
    name: "ClerkAPIResponseError",
    status,
  });
}

beforeEach(() => {
  h.userId = USER_ID;
  h.userRow = { email: EMAIL, stripeCustomerId: null };
  h.liveSub = undefined;
  h.writes = [];
  h.selects = 0;
  h.usersDeleteFails = false;
  h.clerkClientFails = false;
  h.usersSelectFails = false;
  h.clerkDelete.mockReset().mockResolvedValue({ id: USER_ID });
  h.clerkGone = false;
  h.stripeUpdate.mockReset().mockResolvedValue({ id: "sub_dummy" });
  h.stripeSearch.mockReset().mockResolvedValue({ data: [], has_more: false });
  h.sentryMessage.mockReset();
  // PostHog off: with credentials in the shell the erasure would reach the
  // real persons endpoint.
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
  vi.stubEnv("POSTHOG_PROJECT_ID", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/account/delete — who may delete", () => {
  it("is 401 for an anonymous caller, and nothing is read, erased or deleted at Clerk", async () => {
    h.userId = null;

    const res = await POST(deleteRequest());

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(h.selects).toBe(0);
    expect(h.writes).toEqual([]);
  });

  it("is 401 for a browser cookie session — Bearer-only means the header, not whatever auth() accepts", async () => {
    // auth() would resolve the cookie; the route refuses before asking.
    const res = await POST(deleteRequest({ cookie: "__session=dummy" }));

    expect(res.status).toBe(401);
    expect(h.selects).toBe(0);
    expect(h.writes).toEqual([]);
  });

  it("is 401 for a scheme Clerk does not read as a header token (it would fall back to the cookie)", async () => {
    const res = await POST(deleteRequest({ authorization: "bearer sess_dummy" }));

    expect(res.status).toBe(401);
    expect(h.writes).toEqual([]);
  });
});

describe("POST /api/v1/account/delete — the deletion", () => {
  it("erases our side FIRST, then deletes the Clerk account, and answers {ok:true} uncached", async () => {
    const res = await POST(deleteRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
    ]);
    expect(h.userRow).toBeUndefined();
  });

  it("sets a live subscription to cancel at period end before the account goes at Clerk — what the dialog promises", async () => {
    h.userRow = { email: EMAIL, stripeCustomerId: "cus_dummy" };
    h.liveSub = { stripeSubscriptionId: "sub_live" };
    h.stripeUpdate.mockImplementation(async () => {
      h.writes.push("stripe cancel_at_period_end");
      return { id: "sub_live" };
    });

    const res = await POST(deleteRequest());

    expect(res.status).toBe(200);
    expect(h.stripeUpdate).toHaveBeenCalledWith(
      "sub_live",
      { cancel_at_period_end: true },
      expect.any(Object),
    );
    expect(h.writes).toEqual([
      "stripe cancel_at_period_end",
      "insert erased_customers",
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
    ]);
  });

  it("treats Clerk's 404 as done — the account is already gone (a double tap, the dashboard)", async () => {
    h.clerkDelete.mockRejectedValueOnce(clerkError(404));

    const res = await POST(deleteRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.sentryMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/account/delete — Sign in with Apple's grant (#407)", () => {
  // The app sends a fresh Apple authorization code for an Apple account;
  // the route exchanges it and revokes the grant between our erasure and
  // Clerk (lib/apple-revoke.ts has its own suite for Apple's protocol). Apple
  // is a fake fetch that writes into the same ordered log as the database
  // and Clerk. Whatever Apple does, the deletion completes.
  const CODE = "c0de-dummy-apple-authorization";
  let apple: { token: () => Promise<Response>; revoke: () => Promise<Response> };

  function withCode(body: unknown = { appleAuthorizationCode: CODE }) {
    return new Request("https://matio.tv/api/v1/account/delete", {
      method: "POST",
      headers: { authorization: "Bearer sess_dummy", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0];
  }

  const done = (): Record<string, unknown> | undefined =>
    vi.mocked(console.info).mock.calls.find((c) => c[0] === "account delete: done")?.[1] as
      | Record<string, unknown>
      | undefined;

  beforeEach(() => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    vi.stubEnv("APPLE_TEAM_ID", "TEAMDUMMY1");
    vi.stubEnv("APPLE_SIGN_IN_KEY_ID", "KEYDUMMY01");
    vi.stubEnv(
      "APPLE_SIGN_IN_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    apple = {
      token: async () =>
        new Response(JSON.stringify({ refresh_token: "r-dummy", access_token: "a-dummy" }), {
          status: 200,
        }),
      revoke: async () => new Response(null, { status: 200 }),
    };
    vi.stubGlobal("fetch", async (url: string) => {
      if (url === "https://appleid.apple.com/auth/token") {
        h.writes.push("apple token");
        return apple.token();
      }
      if (url === "https://appleid.apple.com/auth/revoke") {
        h.writes.push("apple revoke");
        return apple.revoke();
      }
      throw new Error(`unexpected request to ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revokes AFTER our erasure and BEFORE the Clerk account goes — then {ok:true}", async () => {
    const res = await POST(withCode());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      "apple token",
      "apple revoke",
      `clerk deleteUser ${USER_ID}`,
    ]);
    expect(done()).toMatchObject({ userId: USER_ID, apple: { status: "revoked" }, clerk: "deleted" });
    expect(h.sentryMessage).not.toHaveBeenCalled();
  });

  it("Apple refusing the code (400 invalid_grant) still deletes the account — logged and sent to Sentry by id", async () => {
    apple.token = async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });

    const res = await POST(withCode());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      "apple token",
      `clerk deleteUser ${USER_ID}`,
    ]);
    expect(done()).toMatchObject({
      apple: { status: "failed", step: "token", httpStatus: 400, appleError: "invalid_grant" },
      clerk: "deleted",
    });
    expect(h.sentryMessage).toHaveBeenCalledWith(
      expect.stringContaining("Apple token revocation failed"),
      expect.objectContaining({
        level: "warning",
        tags: { userId: USER_ID, step: "apple", appleStep: "token" },
      }),
    );
  });

  it("Apple timing out on the revocation still deletes the account", async () => {
    apple.revoke = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };

    const res = await POST(withCode());

    expect(res.status).toBe(200);
    expect(h.writes.at(-1)).toBe(`clerk deleteUser ${USER_ID}`);
    expect(done()).toMatchObject({
      apple: { status: "failed", step: "revoke", error: { name: "TimeoutError" } },
    });
  });

  it("no Apple key in the env: nothing goes to Apple, the deletion is what it was before #407", async () => {
    vi.stubEnv("APPLE_SIGN_IN_PRIVATE_KEY", "");

    const res = await POST(withCode());

    expect(res.status).toBe(200);
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
    ]);
    expect(done()).toMatchObject({ apple: { status: "skipped_unconfigured" } });
    expect(h.sentryMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["no body at all (a build from before #407, an account without Apple)", undefined],
    ["a body that is not JSON", "not json"],
    ["a body without a code (a cancelled Apple sheet)", {}],
  ])("%s → skipped_no_code, nothing goes to Apple, the account is deleted", async (_label, body) => {
    const res = await POST(body === undefined ? deleteRequest() : withCode(body));

    expect(res.status).toBe(200);
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
    ]);
    expect(done()).toMatchObject({ apple: { status: "skipped_no_code" } });
  });

  it("an erasure the database refuses spends nothing at Apple — the account and its grant stay for the retry", async () => {
    h.usersDeleteFails = true;

    const res = await POST(withCode());

    expect(res.status).toBe(500);
    expect(h.writes.some((w) => w.startsWith("apple"))).toBe(false);
    expect(h.clerkDelete).not.toHaveBeenCalled();
  });

  it("a Clerk refusal after the revocation is still the 500 a retry finishes — and its log names Apple's outcome", async () => {
    h.clerkDelete.mockRejectedValueOnce(clerkError(500));

    const res = await POST(withCode());

    expect(res.status).toBe(500);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Clerk account could NOT be deleted"),
      expect.objectContaining({ userId: USER_ID, apple: { status: "revoked" } }),
    );
  });
});

describe("POST /api/v1/account/delete — failures a retry finishes", () => {
  it("an erasure the database refuses is 500 and leaves the Clerk account alone — the viewer can retry", async () => {
    h.usersDeleteFails = true;

    const res = await POST(deleteRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
    expect(h.clerkDelete).not.toHaveBeenCalled();
    expect(h.writes.some((w) => w.startsWith("clerk"))).toBe(false);
    expect(h.userRow).toBeDefined();
    expect(h.sentryMessage).toHaveBeenCalledWith(
      expect.stringContaining("erasure failed"),
      expect.objectContaining({ tags: { userId: USER_ID, step: "erase" } }),
    );

    // The retry (same session, database back) converges: erased, then Clerk.
    h.writes = [];
    const retry = await POST(deleteRequest());

    expect(retry.status).toBe(200);
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
    ]);
  });

  it("a Clerk refusal after the erasure is 500; the retry erases nothing twice and finishes at Clerk", async () => {
    h.clerkDelete.mockRejectedValueOnce(clerkError(500));

    const res = await POST(deleteRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
    expect(h.userRow).toBeUndefined(); // our side is erased already
    expect(h.sentryMessage).toHaveBeenCalledWith(
      expect.stringContaining("Clerk account NOT deleted"),
      expect.objectContaining({ tags: { userId: USER_ID, step: "clerk" } }),
    );

    h.writes = [];
    const retry = await POST(deleteRequest());

    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true });
    // eraseUser's not-found path writes nothing locally; only Clerk is asked again.
    expect(h.writes).toEqual([`clerk deleteUser ${USER_ID}`]);
  });

  it("a Clerk 503 still runs the sweep before the 500 — if the delete committed anyway, no retry would ever come for a healed row", async () => {
    // During the erasure's vendor window a /v1/progress heal (#303) put the
    // row back; then Clerk answers 503 — which does not prove it kept the
    // account.
    h.clerkDelete.mockImplementationOnce(async () => {
      h.userRow = { email: EMAIL, stripeCustomerId: null };
      throw clerkError(503);
    });

    const res = await POST(deleteRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
    expect(h.userRow).toBeUndefined();
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
    ]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Clerk account could NOT be deleted"),
      expect.objectContaining({ userId: USER_ID, httpStatus: 503, sweep: "erased_again" }),
    );
  });

  it("a Clerk client that cannot even be built (no key) is the same 500, not an unhandled throw", async () => {
    h.clerkClientFails = true;

    const res = await POST(deleteRequest());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
    expect(h.clerkDelete).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/account/delete — the sweep after Clerk (step 3)", () => {
  it("a users row healed back from Clerk between the erasure and the Clerk delete (#303's /v1/progress) is erased again", async () => {
    // A progress save lands while the account still exists at Clerk: its
    // heal re-creates the mirror row, address and all.
    h.clerkDelete.mockImplementationOnce(async () => {
      h.userRow = { email: EMAIL, stripeCustomerId: null };
      return { id: USER_ID };
    });

    const res = await POST(deleteRequest());

    expect(res.status).toBe(200);
    expect(h.userRow).toBeUndefined();
    expect(h.writes).toEqual([
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
      `clerk deleteUser ${USER_ID}`,
      "delete show_reminders",
      "delete idea_submissions",
      "delete users",
    ]);
    expect(console.info).toHaveBeenCalledWith(
      "account delete: done",
      expect.objectContaining({ userId: USER_ID, sweep: "erased_again" }),
    );
  });

  it("finds nothing to sweep on an ordinary deletion — one erasure, no second pass", async () => {
    await POST(deleteRequest());

    expect(h.writes.filter((w) => w === "delete users")).toHaveLength(1);
    expect(console.info).toHaveBeenCalledWith(
      "account delete: done",
      expect.objectContaining({ sweep: "clean", clerk: "deleted", erase: "erased" }),
    );
  });

  it("a sweep that fails is shouted by id for the operator — the deletion the viewer asked for still stands", async () => {
    h.clerkDelete.mockImplementationOnce(async () => {
      h.usersSelectFails = true;
      return { id: USER_ID };
    });

    const res = await POST(deleteRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.sentryMessage).toHaveBeenCalledWith(
      expect.stringContaining("sweep failed"),
      expect.objectContaining({ tags: { userId: USER_ID, step: "sweep" } }),
    );
  });
});

describe("the later Clerk `user.deleted` webhook", () => {
  it("meets an erased account and takes eraseUser's not-found path — a 200 that writes nothing", async () => {
    await POST(deleteRequest());
    h.writes = [];

    const res = await clerkWebhook(
      new Request("https://matio.tv/api/webhooks/clerk", {
        method: "POST",
        body: JSON.stringify({
          type: "user.deleted",
          object: "event",
          data: { id: USER_ID, object: "user", deleted: true },
        }),
      }) as unknown as Parameters<typeof clerkWebhook>[0],
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK (already erased)");
    expect(h.writes).toEqual([]);
    expect(h.stripeUpdate).not.toHaveBeenCalled();
  });
});

describe("a late Clerk `user.created` redelivery (#336 (b))", () => {
  // Svix retried a failed user.created for hours; it lands after the app's
  // deletion. Clerk answers 404 about the account, so nothing is put back.
  it("after the deletion it writes nothing — the users row stays gone", async () => {
    await POST(deleteRequest());
    h.writes = [];

    const res = await clerkWebhook(
      new Request("https://matio.tv/api/webhooks/clerk", {
        method: "POST",
        body: JSON.stringify({
          type: "user.created",
          object: "event",
          data: {
            id: USER_ID,
            object: "user",
            primary_email_address_id: "idn_1",
            email_addresses: [{ id: "idn_1", email_address: EMAIL }],
          },
        }),
      }) as unknown as Parameters<typeof clerkWebhook>[0],
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK (account deleted, skipped)");
    expect(h.writes).toEqual([]);
    expect(h.userRow).toBeUndefined();
  });
});
