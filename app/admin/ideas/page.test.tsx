import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ru } from "@/lib/i18n/admin-dictionaries";

// The /admin/ideas list (#297). The JSX tree is inspected, not rendered (the
// /about page test precedent): what matters is WHICH columns the query reads
// — never the 10,000-character story — the cap, and that the row delete
// stays on the list.
const h = vi.hoisted(() => ({
  calls: [] as string[],
  selects: [] as Array<{
    fields: Record<string, unknown>;
    from?: unknown;
    leftJoin?: unknown[];
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
        leftJoin: (...args: unknown[]) => ((rec.leftJoin = args), chain),
        orderBy: (o: unknown) => ((rec.orderBy = o), chain),
        limit: async (n: number) => ((rec.limit = n), result()),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  },
}));
// A bound server action is opaque; this stand-in keeps the bound arguments.
vi.mock("./actions", () => ({
  deleteIdeaSubmission: {
    bind: (...args: unknown[]) => ({ boundArgs: args }),
  },
}));

import { ideaSubmissions, shows } from "@/db/schema";
import IdeasPage from "./page";

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
    typeof v === "string" || Array.isArray(v) || isValidElement(v)
      ? texts(v as ReactNode)
      : [],
  );
}

const ROW = {
  id: "3f0c2a4e-8b1d-4c6a-9e2f-5a7b8c9d0e1f",
  createdAt: new Date("2026-09-27T10:15:00Z"),
  kind: "continuation" as const,
  showTitle: "The Scarlet Oath",
  workingTitle: "The Last Letter",
  logline: "What if the postman kept one letter back?",
  authorName: "Pen Name",
  email: "fan@example.com",
  locale: "es",
  marketingOptIn: true,
  firstSource: "ig",
  firstCampaign: "ideas-launch",
};

beforeEach(() => {
  h.calls = [];
  h.selects = [];
  h.rows = [];
  h.total = 0;
});

describe("/admin/ideas list", () => {
  it("never selects the story, joins the show, newest first, capped at 500", async () => {
    h.rows = [ROW];
    h.total = 1;

    await IdeasPage();

    const [list, total] = h.selects;
    expect(Object.keys(list.fields)).not.toContain("story");
    expect(Object.values(list.fields)).not.toContain(ideaSubmissions.story);
    expect(list.fields.logline).toBe(ideaSubmissions.logline);
    expect(list.fields.showTitle).toBe(shows.title);
    expect(list.from).toBe(ideaSubmissions);
    expect(list.leftJoin).toEqual([
      shows,
      { eq: [ideaSubmissions.showId, shows.id] },
    ]);
    expect(list.orderBy).toEqual({ desc: ideaSubmissions.createdAt });
    expect(list.limit).toBe(500);
    expect(total.from).toBe(ideaSubmissions);
    expect(h.calls[0]).toBe("requireAdmin");
  });

  it("renders a row with its fields and a delete bound to stay on the list", async () => {
    h.rows = [ROW];
    h.total = 1;

    const tree = await IdeasPage();
    const all = elements(tree);
    const words = texts(tree);

    expect(words).toContain(ru.ideasList.countLine(1, 1));
    expect(words).toContain("The Scarlet Oath");
    expect(words).toContain(ROW.logline);
    expect(words).toContain(ROW.email);
    expect(words).toContain("ig · ideas-launch");
    expect(words).toContain("2026-09-27 10:15 UTC");
    expect(all.some((el) => el.props.href === `/admin/ideas/${ROW.id}`)).toBe(
      true,
    );
    const forms = all.filter((el) => el.type === "form");
    expect(forms.map((f) => f.props.action)).toEqual([
      { boundArgs: [null, ROW.id, "list"] },
    ]);
  });

  it("says how many rows the cap hides", async () => {
    h.rows = [ROW];
    h.total = 1234;

    const words = texts(await IdeasPage());

    expect(words).toContain(ru.ideasList.countLine(1, 1234));
    expect(ru.ideasList.countLine(1, 1234)).toMatch(/1.*1234/);
  });

  it("a new series and a hard-deleted show read as such", async () => {
    h.rows = [
      { ...ROW, id: "a", kind: "new_series", showTitle: null },
      { ...ROW, id: "b", kind: "continuation", showTitle: null },
    ];
    h.total = 2;

    const words = texts(await IdeasPage());

    expect(words).toContain(ru.ideasList.newSeries);
    expect(words).toContain(ru.ideasList.showGone);
  });

  it("an empty table shows the empty state and no table", async () => {
    const tree = await IdeasPage();

    expect(texts(tree)).toContain(ru.ideasList.empty);
    expect(elements(tree).some((el) => el.type === "table")).toBe(false);
  });
});
