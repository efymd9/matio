import { isValidElement, type ReactElement, type ReactNode } from "react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ru } from "@/lib/i18n/admin-dictionaries";

// One job application in the admin (#376). A candidate's text is untrusted
// input shown to the studio: it reaches the page as plain React text
// children — never through dangerouslySetInnerHTML, never auto-linked — and
// the only links are the candidate's own http(s) links, through
// CandidateLink (its own suite pins the http-only rule). The JSX tree is
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
        where: (w: unknown) => ((h.where = w), chain),
        limit: async () => (h.row ? [h.row] : []),
      };
      return chain;
    },
  },
}));
vi.mock("../actions", () => ({
  deleteJobApplication: {
    bind: (...args: unknown[]) => ({ boundArgs: args }),
  },
}));

import { jobApplications } from "@/db/schema";
import { CandidateLink } from "@/components/admin/candidate-link";
import { JobApplicationDeleteForm } from "@/components/admin/job-application-delete-form";
import JobApplicationDetailPage from "./page";

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
    if (Array.isArray(v) || isValidElement(v)) walk(v as ReactNode, [...ancestors, el], out);
  }
  return out;
}

const ID = "3f0c2a4e-8b1d-4c6a-9e2f-5a7b8c9d0e1f";
const MESSAGE =
  'I cut trailers.\n<script>alert("x")</script>\nSee https://x.example.com\n<b>bold</b>';
const ROW = {
  id: ID,
  createdAt: new Date("2026-10-15T10:15:00Z"),
  position: "ai-creator" as const,
  fullName: "Ana Rivera",
  email: "ana@example.com",
  location: "Madrid, Spain",
  linkedinUrl: "https://www.linkedin.com/in/ana-rivera",
  portfolioUrl: null,
  socialLinks: [
    { platform: "tiktok" as const, value: "@ana.films" },
    { platform: "youtube" as const, value: "https://youtube.com/@ana" },
  ],
  message: MESSAGE,
  contentHash: "a".repeat(64),
};

function page(id: string) {
  return JobApplicationDetailPage({ params: Promise.resolve({ id }) });
}

beforeEach(() => {
  h.calls = [];
  h.row = null;
  h.where = null;
});

describe("/admin/careers/[id]", () => {
  it("a malformed id is a 404 before any query (no 22P02 → 500)", async () => {
    await expect(page("not-a-uuid")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(page(`${ID}' or 1=1`)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.calls).not.toContain("select");
  });

  it("an unknown id is a 404, after the admin check", async () => {
    await expect(page(ID)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.calls).toEqual(["requireAdmin", "select", "notFound"]);
    expect(h.where).toEqual({ eq: [jobApplications.id, ID] });
  });

  it("shows every field; the message is a plain text child — no HTML injection, no auto-link", async () => {
    h.row = ROW;

    const nodes = walk(await page(ID));

    expect(nodes.filter(({ el }) => "dangerouslySetInnerHTML" in el.props)).toEqual([]);
    // No raw anchor or next/link anywhere: the only links are CandidateLinks.
    expect(nodes.some(({ el }) => el.type === "a" || el.type === Link)).toBe(false);
    for (const text of [MESSAGE, ROW.email, ROW.fullName, ROW.location, ID]) {
      const holder = nodes.find(({ el }) => el.props.children === text);
      expect(holder, text).toBeDefined();
      expect(typeof holder!.el.props.children).toBe("string");
    }
    const message = nodes.find(({ el }) => el.props.children === MESSAGE)!;
    expect(message.el.type).toBe("p");
    expect(String(message.el.props.className)).toContain("whitespace-pre-wrap");
    // The role, by its title.
    expect(nodes.some(({ el }) => el.props.children === "AI Creator")).toBe(true);
  });

  it("every link and profile goes through CandidateLink; a missing portfolio reads as a dash", async () => {
    h.row = ROW;

    const nodes = walk(await page(ID));

    const links = nodes.filter(({ el }) => el.type === CandidateLink).map(({ el }) => el.props.value);
    expect(links).toEqual([
      ROW.linkedinUrl,
      "@ana.films",
      "https://youtube.com/@ana",
    ]);
    expect(nodes.some(({ el }) => el.props.children === "TikTok")).toBe(true);
    expect(nodes.some(({ el }) => el.props.children === ru.careerDetail.none)).toBe(true);
  });

  it("the delete is bound to leave for the list (its own row is gone)", async () => {
    h.row = { ...ROW, socialLinks: [] };

    const nodes = walk(await page(ID));
    const forms = nodes.filter(({ el }) => el.type === JobApplicationDeleteForm);

    expect(forms.map(({ el }) => el.props.action)).toEqual([
      { boundArgs: [null, ID, "detail"] },
    ]);
    expect(forms[0].el.props.label).toBe(ru.careerDetail.deleteThis);
  });
});
