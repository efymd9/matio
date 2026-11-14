import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ configured: true, send: vi.fn() }));
vi.mock("./resend", () => ({
  resendConfigured: () => h.configured,
  getResend: () => ({ emails: { send: h.send } }),
  emailFrom: () => "Matio <updates@example.invalid>",
}));

import { ENQUIRY_INBOX, renderEnquiryText, sendEnquiryEmail, type EnquiryEmail } from "./b2b-enquiry-email";

const email = (over: Partial<EnquiryEmail> = {}): EnquiryEmail => ({
  kind: "studio",
  subject: "Studio brief — VFX for existing footage",
  replyTo: "ana@studio.example",
  fields: [
    ["Name", "Ana"],
    ["Timeline", ""],
  ],
  body: "Brief:\nTwelve shots.",
  ...over,
});

beforeEach(() => {
  h.configured = true;
  h.send.mockReset().mockResolvedValue({ data: { id: "e1" }, error: null });
});

describe("renderEnquiryText", () => {
  it("lists the filled fields, then the body, then the reply note — empty fields dropped", () => {
    expect(renderEnquiryText(email())).toBe(
      "Name: Ana\n\nBrief:\nTwelve shots.\n\n—\nSent from the form on matio.tv. Reply to this email to answer the sender directly.",
    );
  });
});

describe("sendEnquiryEmail", () => {
  it("sends plain text to the studio inbox with the sender as Reply-To", async () => {
    expect(await sendEnquiryEmail(email())).toEqual({ ok: true });
    expect(ENQUIRY_INBOX).toBe("maksym@matio.tv");
    const [payload, opts] = h.send.mock.calls[0];
    expect(payload).toEqual({
      from: "Matio <updates@example.invalid>",
      to: "maksym@matio.tv",
      replyTo: "ana@studio.example",
      subject: "Studio brief — VFX for existing footage",
      text: renderEnquiryText(email()),
    });
    expect(payload).not.toHaveProperty("html");
    expect(opts.idempotencyKey).toMatch(/^enquiry\/studio\/[0-9a-f]{64}$/);
  });

  it("the same enquiry twice carries the same key; a changed one a new key", async () => {
    await sendEnquiryEmail(email());
    await sendEnquiryEmail(email());
    await sendEnquiryEmail(email({ body: "Brief:\nThirteen shots." }));
    const keys = h.send.mock.calls.map((c) => c[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("never throws: unconfigured, a Resend error and a rejection all come back as codes", async () => {
    h.configured = false;
    expect(await sendEnquiryEmail(email())).toEqual({ ok: false, code: "not_configured" });
    expect(h.send).not.toHaveBeenCalled();

    h.configured = true;
    h.send.mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", message: "x" } });
    expect(await sendEnquiryEmail(email())).toEqual({ ok: false, code: "rate_limit_exceeded" });

    h.send.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await sendEnquiryEmail(email())).toEqual({ ok: false, code: "TypeError" });
  });
});
