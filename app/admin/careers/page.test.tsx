import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ru } from "@/lib/i18n/admin-dictionaries";

// The /admin/careers list (#376). The JSX tree is inspected, not rendered
// (the /admin/ideas precedent): which columns the query reads — never the
// message or the links — the cap, the `?position=` filter (and only a real
// role filters), and that the row delete stays on the list.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  selects: [] as Array<{
    fields: Record<string, unknown>;
    from?: unknown;
    where?: unknown;
    orderBy?: unknown;
    limit?: number;
  }>,
  rows: [] as unknown[],
  total: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin", () => ({
  requireAdmin: async () => {
    h.calls.push("requireAdmin");
    return { id: "admin-1" };
  },
}));
vi.mock("@/lib/i18n/admin-server", () => ({
  getAdminDict: async () => ({ locale: "ru", t: ru }),
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  count: () => ({ count: "*" }),
  desc: (column: unknown) => ({ desc: column }),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
}));
// The first select is the list, the second the total count.
vi.mock("@/db", () => ({
  db: {
    select: (fields: Record<string, unknown>) => {
      h.calls.push("select");
      const rec: (typeof h.selects)[number] = { fields };
      h.selects.push(rec);
      const isCount = h.selects.length === 2;
      const result = () => (isCount ? [{ total: h.total }] : h.rows);
      const chain = {
        from: (t: unknown) => ((rec.from = t), chain),
        where: (w: unknown) => ((rec.where = w), chain),
        orderBy: (o: unknown) => ((rec.orderBy = o), chain),
        limit: async (n: number) => ((rec.limit = n), result()),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  },
}));
// A bound server action is opaque; this stand-in keeps the bound arguments.
vi.mock("./actions", () => ({
  deleteJobApplication: {
    bind: (...args: unknown[]) => ({ boundArgs: args }),
  },
}));

import { jobApplications } from "@/db/schema";
import { JobApplicationDeleteForm } from "@/components/admin/job-application-delete-form";
import CareersApplicationsPage from "./page";

type AnyElement = ReactElement<Record<string, unknown>>;

function elements(node: ReactNode): AnyElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const el = node as AnyElement;
  const nested = Object.values(el.props).flatMap((v) =>
    Array.isArray(v) || isValidElement(v) ? elements(v as ReactNode) : [],
  );
  return [el, ...nested];
}

function texts(node: ReactNode): string[] {
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!isValidElement(node)) return [];
  return Object.values((node as AnyElement).props).flatMap((v) =>
    typeof v === "string" || Array.isArray(v) || isValidElement(v) ? texts(v as ReactNode) : [],
  );
}

const ROW = {
  id: "3f0c2a4e-8b1d-4c6a-9e2f-5a7b8c9d0e1f",
  createdAt: new Date("2026-10-15T10:15:00Z"),
  fullName: "Ana Rivera",
  position: "sales-distribution" as const,
  location: "Madrid, Spain",
  email: "ana@example.com",
};

const page = (position?: string | string[]) =>
  CareersApplicationsPage({
    searchParams: Promise.resolve(position === undefined ? {} : { position }),
  });

beforeEach(() => {
  h.calls = [];
  h.selects = [];
  h.rows = [];
  h.total = 0;
});

describe("/admin/careers list", () => {
  it("checks the admin first; never selects the message or the links; newest first, capped at 500", async () => {
    h.rows = [ROW];
    h.total = 1;

    await page();

    expect(h.calls[0]).toBe("requireAdmin");
    const [list, total] = h.selects;
    expect(Object.keys(list.fields).sort()).toEqual(
      ["createdAt", "email", "fullName", "id", "location", "position"].sort(),
    );
    for (const hidden of [
      jobApplications.message,
      jobApplications.linkedinUrl,
      jobApplications.portfolioUrl,
      jobApplications.socialLinks,
    ]) {
      expect(Object.values(list.fields)).not.toContain(hidden);
    }
    expect(list.from).toBe(jobApplications);
    expect(list.where).toBeUndefined();
    expect(list.orderBy).toEqual({ desc: jobApplications.createdAt });
    expect(list.limit).toBe(500);
    expect(total.from).toBe(jobApplications);
  });

  it("renders the row's date, name, role, city and address, an Open link and a delete bound to stay on the list", async () => {
    h.rows = [ROW];
    h.total = 1;

    const tree = await page();
    const all = elements(tree);
    const words = texts(tree);

    expect(words).toContain(ru.careersList.countLine(1, 1));
    expect(words).toContain("2026-10-15 10:15 UTC");
    expect(words).toContain("Ana Rivera");
    expect(words).toContain("Sales & Distribution");
    expect(words).toContain("Madrid, Spain");
    expect(words).toContain("ana@example.com");
    expect(all.some((el) => el.props.href === `/admin/careers/${ROW.id}`)).toBe(true);
    const deletes = all.filter((el) => el.type === JobApplicationDeleteForm);
    expect(deletes.map((d) => d.props.action)).toEqual([
      { boundArgs: [null, ROW.id, "list"] },
    ]);
    expect(deletes[0].props.confirm).toBe(ru.careerDetail.deleteConfirm);
  });

  it("?position=<role> filters both the list and the count, and marks that filter current", async () => {
    const tree = await page("ai-creator");

    const [list, total] = h.selects;
    expect(list.where).toEqual({ eq: [jobApplications.position, "ai-creator"] });
    expect(total.where).toEqual({ eq: [jobApplications.position, "ai-creator"] });
    const current = elements(tree).filter((el) => el.props["aria-current"] === "page");
    expect(current.map((el) => el.props.href)).toEqual(["/admin/careers?position=ai-creator"]);
    expect(texts(tree)).toContain(ru.careersList.emptyFiltered);
  });

  it("offers All · AI Creator · Sales & Distribution; an unknown or repeated ?position= is All", async () => {
    for (const junk of ["screenwriter", ["ai-creator", "sales-distribution"]]) {
      h.selects = [];
      const tree = await page(junk);
      expect(h.selects[0].where).toBeUndefined();
      const links = elements(tree).filter(
        (el) => typeof el.props.href === "string" && String(el.props.href).startsWith("/admin/careers"),
      );
      expect(links.map((el) => el.props.href)).toEqual([
        "/admin/careers",
        "/admin/careers?position=ai-creator",
        "/admin/careers?position=sales-distribution",
      ]);
      expect(links.map((el) => el.props.children)).toEqual([
        ru.careersList.filterAll,
        "AI Creator",
        "Sales & Distribution",
      ]);
      expect(links[0].props["aria-current"]).toBe("page");
    }
  });

  it("an empty table shows the empty state and no table", async () => {
    const tree = await page();

    expect(texts(tree)).toContain(ru.careersList.empty);
    expect(elements(tree).some((el) => el.type === "table")).toBe(false);
  });
});
