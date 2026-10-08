import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { emailFrom, emailReplyTo } from "./resend";

afterEach(() => {
  vi.unstubAllEnvs();
});

// Replies to a reminder email land in the public support mailbox — the one
// /privacy, /terms and the press page name (#414: contact@ stopped
// receiving mail, so the default moved with the published address).
describe("the reminder email's sender identity", () => {
  it("replies go to the public support address by default", () => {
    vi.stubEnv("RESEND_REPLY_TO", undefined);
    expect(emailReplyTo()).toBe("maksym@matio.tv");
  });

  it("RESEND_REPLY_TO overrides the reply address without a code change", () => {
    vi.stubEnv("RESEND_REPLY_TO", "support@example.test");
    expect(emailReplyTo()).toBe("support@example.test");
  });

  it("sends from updates@, apart from the support mailbox", () => {
    vi.stubEnv("RESEND_FROM", undefined);
    expect(emailFrom()).toBe("Matio <updates@matio.tv>");
  });
});
