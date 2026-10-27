import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

// #485 — what the App Privacy answers for the first iOS submission (#486)
// declare, /privacy has to say too. Clerk records, for every sign-in session,
// the approximate location it resolves from the IP address (its
// SessionActivity object: city, country, IP address, browser, device type) —
// "Coarse Location, linked to the user". The text is a DRAFT (counsel, #168);
// what these cases pin is that the Clerk passages say it, in the web and the
// app sections alike, and that the mailbox processor is the one MX points at
// (Google Workspace since 08.10.2026, #414) — Namecheap nowhere on the page.
//
// Real getDict and LegalLink: only the request is faked, as in
// ./careers-section.test.tsx.

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/link", async () => await import("@/tools/test/next-link-probe"));

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

/** The <li> of a section that contains `marker`, as text. */
function item(sectionId: string, marker: string): string {
  const items = section(sectionId).split("<li").map(text);
  const hit = items.find((i) => i.includes(marker));
  expect(hit, `${sectionId}: ${marker}`).toBeDefined();
  return hit ?? "";
}

/** Text with tags stripped and whitespace collapsed. */
const text = (markup: string) =>
  markup.replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "").replace(/\s+/g, " ");

beforeEach(async () => {
  html = await render();
});

describe("/privacy × Clerk's approximate location (#485)", () => {
  it("§2 «Account data» says what Clerk records per session, why, and for how long", () => {
    const s = item("data", "Account data");
    expect(s).toContain("For each sign-in session, Clerk also records the approximate location");
    expect(s).toContain("the city and country, worked out from the IP address");
    expect(s).toContain("that IP address and the browser and type of device");
    expect(s).toContain("to keep your account secure");
    expect(s).toContain("we don’t use it for anything else");
    // No invented window: the record lives with the account, as §6 says.
    expect(s).toContain("It is kept with your account (“Account” in section 6)");
    expect(text(section("retention"))).toContain("Account: while your account exists");
  });

  it("the §4 Clerk row names the session record and its location", () => {
    const s = item("sharing", "Clerk Inc.");
    expect(s).toContain("the record of each sign-in session described in section 2");
    expect(s).toContain("including its approximate location");
  });

  it("§11 says the same for a session signed in from the app", () => {
    const s = item("app", "If you sign in");
    expect(s).toContain("Clerk records the approximate location of each sign-in session");
    expect(s).toContain("the city and country, worked out from your IP address");
  });
});

describe("/privacy × the domain mailbox (#485, #414)", () => {
  it("§4 names Google Workspace for maksym@matio.tv", () => {
    const s = item("sharing", "Google Workspace");
    expect(s).toContain("Google Ireland Ltd (Google Workspace");
    expect(s).toContain("maksym@matio.tv");
  });

  it("names neither Namecheap nor PrivateEmail anywhere", () => {
    expect(html).not.toMatch(/namecheap|privateemail/i);
  });
});
