import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin's one write on job applications (#376). What matters: the admin
// check runs before anything touches the table; a failure is a TYPED answer
// (never a throw — a thrown message is masked in prod) that carries no
// candidate data; and only the detail page (whose own row is gone) leaves
// for the list.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  deleted: [] as Array<{ table: unknown; where: unknown }>,
  admin: true,
  deleteError: undefined as unknown,
  sentryMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: h.sentryMessage }));
vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => {
    h.calls.push("requireAdmin");
    // The real requireAdmin redirects a non-admin, i.e. throws.
    if (!h.admin) throw new Error("NEXT_REDIRECT /");
    return { id: "admin-1" };
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    h.calls.push(`revalidate ${p}`);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.calls.push(`redirect ${to}`);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
}));
vi.mock("@/db", () => ({
  db: {
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        h.calls.push("delete");
        if (h.deleteError) throw h.deleteError;
        h.deleted.push({ table, where });
      },
    }),
  },
}));

import { jobApplications } from "@/db/schema";
import { deleteJobApplication } from "./actions";

const ID = "3f0c2a4e-8b1d-4c6a-9e2f-5a7b8c9d0e1f";

beforeEach(() => {
  h.calls = [];
  h.deleted = [];
  h.admin = true;
  h.deleteError = undefined;
  h.sentryMessage.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("deleteJobApplication", () => {
  it("from the list: admin check → delete → revalidate, stays, and answers ok", async () => {
    await expect(deleteJobApplication(ID, "list")).resolves.toEqual({ ok: true });

    expect(h.calls).toEqual(["requireAdmin", "delete", "revalidate /admin/careers"]);
    expect(h.deleted).toEqual([
      { table: jobApplications, where: { eq: [jobApplications.id, ID] } },
    ]);
  });

  it("from the detail page: the same, then leaves for the list", async () => {
    await expect(deleteJobApplication(ID, "detail")).rejects.toThrow(
      "NEXT_REDIRECT /admin/careers",
    );

    expect(h.calls).toEqual([
      "requireAdmin",
      "delete",
      "revalidate /admin/careers",
      "redirect /admin/careers",
    ]);
  });

  it("a non-admin never reaches the table", async () => {
    h.admin = false;

    await expect(deleteJobApplication(ID, "detail")).rejects.toThrow("NEXT_REDIRECT /");

    expect(h.calls).toEqual(["requireAdmin"]);
    expect(h.deleted).toEqual([]);
  });

  it("a failed DELETE is a typed answer, reported by id, class and SQLSTATE — the page stays and nothing is revalidated", async () => {
    h.deleteError = Object.assign(new Error("Failed query: delete … candidate@example.invalid"), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("deadlock"), { name: "PostgresError", code: "40P01" }),
    });

    await expect(deleteJobApplication(ID, "detail")).resolves.toEqual({
      ok: false,
      error: "failed",
    });

    expect(h.calls).toEqual(["requireAdmin", "delete"]);
    expect(console.error).toHaveBeenCalledWith("deleteJobApplication: failed", {
      id: ID,
      name: "DrizzleQueryError",
      code: "40P01",
    });
    expect(h.sentryMessage).toHaveBeenCalledWith("deleteJobApplication: failed", {
      level: "error",
      tags: { code: "40P01", name: "DrizzleQueryError" },
    });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("example.invalid");
  });

  it("a forged id never reaches the driver", async () => {
    await expect(deleteJobApplication("not-a-uuid", "list")).resolves.toEqual({
      ok: false,
      error: "failed",
    });
    expect(h.calls).toEqual(["requireAdmin"]);
  });
});
