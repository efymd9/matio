import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #376 — /privacy and job applications. The text is a DRAFT (counsel, #168);
// what these cases pin is that the page says what the code does: the §6
// window is the retention constant the cron executes, §3 owns up to the one
// thing besides the review that an application causes — the consent-gated
// PostHog count `job_application_submitted {position}` — and §4 names the
// processor that actually carries the mailbox candidates write to (Google
// Workspace since 08.10.2026, #414 — not Namecheap PrivateEmail).
//
// Real getDict and LegalLink: only the request is faked, as in
// ./app-section.test.tsx.

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: () => undefined }));

import { JOB_APPLICATION_RETENTION_MONTHS } from "@/lib/job-application";
import { RETENTION_POLICIES } from "@/lib/retention";
import PrivacyPage from "./page";

let html = "";

async function render(): Promise<string> {
  const { prelude } = await prerender(await PrivacyPage());
  return (await new Response(prelude).text())
    .replaceAll("&rsquo;", "’")
    .replaceAll("&#x27;", "'");
}

/** One section's markup: from its <section> to the next one. */
function section(id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  expect(start, id).toBeGreaterThan(-1);
  const end = html.indexOf("<section", start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

/** Text with tags stripped and whitespace collapsed. */
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "").replace(/\s+/g, " ");

beforeEach(async () => {
  html = await render();
});

describe("/privacy × job applications (#376)", () => {
  it("§2 lists what an application keeps, under the anchor the form links to", () => {
    const s = text(section("data"));
    expect(html).toContain('id="careers"');
    expect(s).toContain("Job applications");
    expect(s).toContain("we don’t accept files");
  });

  it("§6 states the window the retention cron executes — the same constant the form and the FAQ print", () => {
    const policy = RETENTION_POLICIES.find((p) => p.name === "job_applications");
    expect(policy?.window).toEqual({ months: JOB_APPLICATION_RETENTION_MONTHS });
    expect(text(section("retention"))).toContain(
      `Job applications: ${JOB_APPLICATION_RETENTION_MONTHS} months from submission.`,
    );
  });

  it("§3 says the analytics counts a sent application — the role only — instead of promising nothing else happens", () => {
    const s = text(section("purposes"));
    expect(s).toContain("To consider your job application");
    expect(s).toContain("counts that an application for a role was sent");
    expect(s).toContain("never your name, your contact details, your links or what you wrote");
  });

  it("§4 names Google Workspace for the mailbox candidates write to, not Namecheap", () => {
    const s = text(section("sharing"));
    expect(s).toContain("Google Ireland Ltd (Google Workspace");
    expect(s).toContain("maksym@matio.tv");
    expect(s).toContain("job applications");
    expect(s).not.toContain("Namecheap");
    expect(s).not.toContain("PrivateEmail");
  });

  it("§8 holds applications to 18+", () => {
    expect(text(section("children"))).toContain(
      "Story ideas and job applications may only be sent by people aged 18 or over.",
    );
  });
});
