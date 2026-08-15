import { describe, expect, it, vi } from "vitest";

// reminder-email.ts is guarded by `import "server-only"`, which throws outside
// a server-component graph. The guard's job is keeping the module out of
// CLIENT bundles; a node test is neither, so the stub is honest.
vi.mock("server-only", () => ({}));

import { renderShowReminderEmail } from "./reminder-email";

// The sender-identification footer is a legal requirement (UK PECR): every
// marketing email must name who sent it. Since 2026-08-16 that is the
// company, not the sole trader — and regressing this line is a compliance
// bug, not cosmetics, which is why the test pins the exact identity.
describe("renderShowReminderEmail sender identification", () => {
  const input = {
    locale: "en",
    showTitle: "Thunder Lady",
    seasonNumber: 1,
    episodeNumber: 4,
    episodeTitle: "The Storm Breaks",
    genre: ["drama"],
    durationSeconds: 754,
    logline: null,
    heroImageUrl: null,
    watchUrl: "https://matio.tv/watch/thunder-lady?ep=x&utm_source=email",
    unsubscribePageUrl: "https://matio.tv/unsubscribe?e=x&t=y",
    siteUrl: "https://matio.tv",
  };

  it("carries the company identity in both html and text bodies", () => {
    const { html, text } = renderShowReminderEmail(input);

    for (const body of [html, text]) {
      expect(body).toContain("DEEP ORDINARY LTD");
      expect(body).toContain("66 Paul Street, London EC2A 4NA");
      // The pre-2026-08-16 sole-trader identity must never resurface.
      expect(body).not.toContain("Dobrovolskii");
    }
  });

  it("keeps the identity in the Spanish rendering too", () => {
    const { html, text } = renderShowReminderEmail({ ...input, locale: "es" });
    expect(html).toContain("DEEP ORDINARY LTD");
    expect(text).toContain("DEEP ORDINARY LTD");
  });
});
