import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin's one write on story ideas (#297). What matters is the ORDER:
// the admin check runs before anything touches the table, and only the
// detail page (whose own row is gone) leaves for the list.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  deleted: [] as Array<{ table: unknown; where: unknown }>,
  admin: true,
}));

vi.mock("server-only", () => ({}));
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
        h.deleted.push({ table, where });
      },
    }),
  },
}));

import { ideaSubmissions } from "@/db/schema";
import { deleteIdeaSubmission } from "./actions";

const ID = "3f0c2a4e-8b1d-4c6a-9e2f-5a7b8c9d0e1f";

beforeEach(() => {
  h.calls = [];
  h.deleted = [];
  h.admin = true;
});

describe("deleteIdeaSubmission", () => {
  it("from the list: admin check → delete → revalidate, and stays", async () => {
    await expect(deleteIdeaSubmission(ID, "list")).resolves.toBeUndefined();

    expect(h.calls).toEqual([
      "requireAdmin",
      "delete",
      "revalidate /admin/ideas",
    ]);
    expect(h.deleted).toEqual([
      { table: ideaSubmissions, where: { eq: [ideaSubmissions.id, ID] } },
    ]);
  });

  it("from the detail page: the same, then leaves for the list", async () => {
    await expect(deleteIdeaSubmission(ID, "detail")).rejects.toThrow(
      "NEXT_REDIRECT /admin/ideas",
    );

    expect(h.calls).toEqual([
      "requireAdmin",
      "delete",
      "revalidate /admin/ideas",
      "redirect /admin/ideas",
    ]);
  });

  it("a non-admin never reaches the table", async () => {
    h.admin = false;

    await expect(deleteIdeaSubmission(ID, "detail")).rejects.toThrow(
      "NEXT_REDIRECT /",
    );

    expect(h.calls).toEqual(["requireAdmin"]);
    expect(h.deleted).toEqual([]);
  });
});
