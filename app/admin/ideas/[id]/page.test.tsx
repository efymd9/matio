import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ru } from "@/lib/i18n/admin-dictionaries";

// One story idea in the admin (#297). A fan's text is untrusted input shown
// to the studio: it must reach the page as a plain React text child — never
// through dangerouslySetInnerHTML, never wrapped in a link. The JSX tree is
// inspected, not rendered (DangerPanel is an async server component).
const h = vi.hoisted(() => ({
  calls: [] as string[],
  row: null as unknown,
  where: null as unknown,
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
vi.mock("next/navigation", () => ({
  notFound: () => {
    h.calls.push("notFound");
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: unknown, value: unknown) => ({ eq: [column, value] }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => {
      h.calls.push("select");
      const chain = {
        from: () => chain,
        leftJoin: () => chain,
        where: (w: unknown) => ((h.where = w), chain),
        limit: async () => (h.row ? [h.row] : []),
      };
      return chain;
    },
  },
}));
vi.mock("../actions", () => ({
  deleteIdeaSubmission: {
    bind: (...args: unknown[]) => ({ boundArgs: args }),
  },
}));

import { ideaSubmissions } from "@/db/schema";
import IdeaDetailPage from "./page";

type AnyElement = ReactElement<Record<string, unknown>>;

// Every element with the chain of elements above it.
function walk(
  node: ReactNode,
  ancestors: AnyElement[] = [],
  out: Array<{ el: AnyElement; ancestors: AnyElement[] }> = [],
) {
  if (Array.isArray(node)) {
    for (const n of node) walk(n, ancestors, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as AnyElement;
  out.push({ el, ancestors });
  for (const v of Object.values(el.props)) {
    if (Array.isArray(v) || isValidElement(v)) {
      walk(v as ReactNode, [...ancestors, el], out);
    }
  }
  return out;
}

const ID = "3f0c2a4e-8b1d-4c6a-9e2f-5a7b8c9d0e1f";
const STORY =
  'Scene one.\n<script>alert("x")</script>\nRead more at https://x\n<b>bold</b>';
const ROW = {
  id: ID,
  createdAt: new Date("2026-09-27T10:15:00Z"),
  kind: "continuation" as const,
  showTitle: "The Scarlet Oath",
  workingTitle: "The Last Letter",
  logline: "What if the postman kept one letter back?",
  story: STORY,
  authorName: "Pen Name",
  email: "fan@example.com",
  locale: "es",
  marketingOptIn: false,
  termsVersion: "ideas-2026-09-draft1",
  firstSource: "ig",
  firstMedium: "paid",
  firstCampaign: "ideas-launch",
  lastSource: null,
  lastMedium: null,
  lastCampaign: null,
};

function page(id: string) {
  return IdeaDetailPage({ params: Promise.resolve({ id }) });
}

beforeEach(() => {
  h.calls = [];
  h.row = null;
  h.where = null;
});

describe("/admin/ideas/[id]", () => {
  it("a malformed id is a 404 before any query (no 22P02 → 500)", async () => {
    await expect(page("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page(`${ID}' or 1=1`)).rejects.toThrow("NEXT_NOT_FOUND");

    expect(h.calls).not.toContain("select");
  });

  it("an unknown id is a 404", async () => {
    await expect(page(ID)).rejects.toThrow("NEXT_NOT_FOUND");

    expect(h.calls).toEqual(["requireAdmin", "select", "notFound"]);
    expect(h.where).toEqual({ eq: [ideaSubmissions.id, ID] });
  });

  it("renders the story as a plain text child — no HTML injection, no auto-link", async () => {
    h.row = ROW;

    const nodes = walk(await page(ID));

    expect(nodes.filter(({ el }) => "dangerouslySetInnerHTML" in el.props)).toEqual(
      [],
    );
    expect(nodes.some(({ el }) => el.type === "a" || el.type === Link)).toBe(
      false,
    );
    for (const text of [STORY, ROW.email, ROW.logline, ROW.authorName]) {
      const holder = nodes.find(({ el }) => el.props.children === text);
      expect(holder, text).toBeDefined();
      expect(typeof holder!.el.props.children).toBe("string");
      expect(
        [holder!.el, ...holder!.ancestors].some(
          (a) => a.type === "a" || a.type === Link,
        ),
      ).toBe(false);
    }
    const story = nodes.find(({ el }) => el.props.children === STORY)!;
    expect(story.el.type).toBe("p");
    expect(String(story.el.props.className)).toContain("whitespace-pre-wrap");
  });

  it("the delete leaves for the list (its own row is gone)", async () => {
    h.row = ROW;

    const nodes = walk(await page(ID));
    const forms = nodes.filter(({ el }) => el.type === "form");

    expect(forms.map(({ el }) => el.props.action)).toEqual([
      { boundArgs: [null, ID, "detail"] },
    ]);
    expect(h.calls.indexOf("requireAdmin")).toBeLessThan(
      h.calls.indexOf("select"),
    );
  });
});
