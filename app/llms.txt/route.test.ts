import { afterEach, describe, expect, it, vi } from "vitest";

// The REAL route and the REAL lib/free-mode rules: only the env flags move,
// so the test reads /llms.txt the way an AI answer engine does — and the
// sentence it quotes about price and accounts has to be true in each mode
// (#446: the open-free sentence promised "no account" while REQUIRE_SIGNUP=1
// was walling member/subscriber episodes behind a free account).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/catalog", () => ({ getPublishedShows: async () => [] }));

import { GET } from "./route";

// #462: no free preview exists any more — the paid sentence must not promise one.
const PAID =
  "Episodes stream with a paid membership: create an account, then subscribe.";
const FREE_WITH_ACCOUNT =
  "Every episode is free to watch; some episodes ask for a free account.";
const OPEN_FREE =
  "The full catalogue is currently free to watch — no account or payment required.";

async function summary(): Promise<string> {
  const body = await (await GET()).text();
  // The blockquote under the title is the one-paragraph description.
  const line = body.split("\n").find((l) => l.startsWith("> "));
  if (!line) throw new Error("llms.txt has no summary line");
  return line;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/llms.txt — what the summary says about price and accounts (#446)", () => {
  it("paid mode: the membership sentence", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("REQUIRE_SIGNUP", "");

    const line = await summary();
    expect(line).toContain(PAID);
    expect(line).not.toContain(FREE_WITH_ACCOUNT);
    expect(line).not.toContain(OPEN_FREE);
    expect(line).not.toMatch(/preview|free/i);
  });

  it("paid mode ignores REQUIRE_SIGNUP — the tier system owns gating there", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "1");
    vi.stubEnv("REQUIRE_SIGNUP", "1");

    expect(await summary()).toContain(PAID);
  });

  it("free mode behind the signup gate: free, but never 'no account required'", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");
    vi.stubEnv("REQUIRE_SIGNUP", "1");

    const line = await summary();
    expect(line).toContain(FREE_WITH_ACCOUNT);
    expect(line).not.toContain("no account");
    expect(line).not.toContain("paid membership");
  });

  it("open free mode (no gate): the no-account sentence stays", async () => {
    vi.stubEnv("PAYMENTS_ENABLED", "");
    vi.stubEnv("REQUIRE_SIGNUP", "");

    const line = await summary();
    expect(line).toContain(OPEN_FREE);
    expect(line).not.toContain(FREE_WITH_ACCOUNT);
  });
});
