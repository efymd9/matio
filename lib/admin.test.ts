import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

// getOrSyncCurrentUser through the real users-mirror write (lib/user-mirror.ts,
// #380): Clerk (the session, the signed-in user, the Backend API) and the
// database are faked at their boundaries; the erasure is a spy — its own steps
// are pinned by lib/erase-user.test.ts and the Clerk webhook's suite. What is
// under test is what the helper RETURNS for each answer, and that it never
// erases on a guess.
const h = vi.hoisted(() => ({
  sessionUserId: "user_new" as string | null,
  clerkUser: null as unknown,
  /** The caller's own row — appears once an insert of it goes through. */
  ownRow: undefined as Record<string, unknown> | undefined,
  holder: undefined as { id: string } | undefined,
  insertResults: [] as (Error | undefined)[],
  writes: [] as string[],
  getUser: vi.fn(),
  eraseUser: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: h.sessionUserId }),
  currentUser: async () => h.clerkUser,
  clerkClient: async () => ({ users: { getUser: h.getUser } }),
}));

vi.mock("@/db", () => {
  const byEmail = (where: unknown) =>
    new PgDialect().sqlToQuery(where as SQL).sql === '"users"."email" = $1';
  return {
    db: {
      select: () => ({
        from: () => ({
          where: (where: unknown) => ({
            limit: async () => {
              if (byEmail(where)) return h.holder ? [h.holder] : [];
              return h.ownRow ? [h.ownRow] : [];
            },
          }),
        }),
      }),
      insert: () => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoNothing: async () => {
            const fails = h.insertResults.shift();
            if (fails) throw fails;
            h.writes.push("insert users");
            h.ownRow = { ...values, role: "user", stripeCustomerId: null };
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            h.writes.push("update users");
          },
        }),
      }),
    },
  };
});

vi.mock("@/lib/erase-user", () => ({
  eraseUser: async (...args: unknown[]) => {
    h.writes.push(`erase ${String(args[0])}`);
    return h.eraseUser(...args);
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({}) }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

import { getOrSyncCurrentUser } from "./admin";

const USER_ID = "user_new";
const STALE_ID = "user_stale";
const EMAIL = "someone@example.invalid";

const emailTaken = () =>
  Object.assign(new Error('Failed query: insert into "users" …'), {
    cause: Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_unique"'),
      { code: "23505", constraint_name: "users_email_unique" },
    ),
  });

const signedIn = (email: string) => ({
  primaryEmailAddress: { emailAddress: email },
  emailAddresses: [{ emailAddress: email }],
});

beforeEach(() => {
  h.sessionUserId = USER_ID;
  h.clerkUser = signedIn(EMAIL);
  h.ownRow = undefined;
  h.holder = undefined;
  h.insertResults.length = 0;
  h.writes.length = 0;
  h.getUser.mockReset();
  h.eraseUser.mockReset().mockResolvedValue({ status: "erased" });
  vi.stubEnv("POSTHOG_PERSONAL_API_KEY", "");
  vi.stubEnv("POSTHOG_PROJECT_ID", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getOrSyncCurrentUser", () => {
  it("returns null for a signed-out caller and touches nothing", async () => {
    h.sessionUserId = null;

    expect(await getOrSyncCurrentUser()).toBeNull();
    expect(h.writes).toEqual([]);
  });

  it("returns the existing row without writing or asking Clerk", async () => {
    h.ownRow = { id: USER_ID, email: EMAIL };

    expect(await getOrSyncCurrentUser()).toEqual({ id: USER_ID, email: EMAIL });
    expect(h.writes).toEqual([]);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("mirrors a missing row from Clerk and returns it", async () => {
    const user = await getOrSyncCurrentUser();

    expect(user).toMatchObject({ id: USER_ID, email: EMAIL });
    expect(h.writes).toEqual(["insert users"]);
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("returns null when Clerk knows no address for the caller", async () => {
    h.clerkUser = { primaryEmailAddress: null, emailAddresses: [] };

    expect(await getOrSyncCurrentUser()).toBeNull();
    expect(h.writes).toEqual([]);
  });
});

describe("getOrSyncCurrentUser × the address held by another row (#380)", () => {
  beforeEach(() => {
    h.insertResults.push(emailTaken());
    h.holder = { id: STALE_ID };
  });

  it("Clerk 404 for the holder → eraseUser(holder), then the row is inserted and returned", async () => {
    h.getUser.mockRejectedValue(
      Object.assign(new Error("Not Found"), { name: "ClerkAPIResponseError", status: 404 }),
    );

    const user = await getOrSyncCurrentUser();

    expect(user).toMatchObject({ id: USER_ID, email: EMAIL });
    expect(h.getUser).toHaveBeenCalledWith(STALE_ID);
    expect(h.writes).toEqual([`erase ${STALE_ID}`, "insert users"]);
  });

  it("alive with another address → the stale row is corrected, then the row is inserted and returned", async () => {
    h.getUser.mockResolvedValue(signedIn("moved@example.invalid"));

    const user = await getOrSyncCurrentUser();

    expect(user).toMatchObject({ id: USER_ID, email: EMAIL });
    expect(h.writes).toEqual(["update users", "insert users"]);
    expect(h.eraseUser).not.toHaveBeenCalled();
  });

  it("alive and still holding the address → nothing erased or written, returns null", async () => {
    h.getUser.mockResolvedValue(signedIn(EMAIL));

    expect(await getOrSyncCurrentUser()).toBeNull();
    expect(h.writes).toEqual([]);
    expect(h.eraseUser).not.toHaveBeenCalled();
  });

  it("Clerk failing with anything but 404 → nothing erased or written, throws so the next request retries", async () => {
    h.getUser.mockRejectedValue(
      Object.assign(new Error("Service Unavailable"), {
        name: "ClerkAPIResponseError",
        status: 503,
      }),
    );

    await expect(getOrSyncCurrentUser()).rejects.toThrow("Clerk unavailable");
    expect(h.writes).toEqual([]);
    expect(h.eraseUser).not.toHaveBeenCalled();
  });
});
