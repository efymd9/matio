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

});

// #445 — the site is English-only, and so is the email: the renderer takes no
// language at all, so a row captured in Spanish before then gets this too.
describe("renderShowReminderEmail is English for every row", () => {
  it("renders the English subject, body and unsubscribe line", () => {
    const { subject, html, text } = renderShowReminderEmail({
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
    });

    expect(subject).toBe("New episode of Thunder Lady — out now");
    expect(html).toContain('<html lang="en"');
    expect(text).toContain("Thunder Lady · Episode 4");
    expect(text).toContain("Unsubscribe: https://matio.tv/unsubscribe?e=x&t=y");
    for (const body of [html, text]) {
      expect(body).not.toContain("Nuevo episodio");
      expect(body).not.toContain("Darse de baja");
    }
  });
});
