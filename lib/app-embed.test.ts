import { describe, expect, it } from "vitest";
import { isAppEmbedRequest, withAppEmbed } from "./app-embed";

// #310 — which requests are the app's embed of a legal document. Base paths:
// proxy.ts strips /es before asking.
const q = (s: string) => new URLSearchParams(s);

describe("isAppEmbedRequest", () => {
  it("is the three legal documents with embed=app", () => {
    for (const path of ["/terms", "/privacy", "/cookies"]) {
      expect(isAppEmbedRequest(path, q("embed=app"))).toBe(true);
      // Other parameters ride along (a utm tag, a fragment id).
      expect(isAppEmbedRequest(path, q("utm_source=x&embed=app"))).toBe(true);
    }
  });

  it("is nothing else — no other page gets a bare variant", () => {
    for (const path of ["/", "/about", "/press", "/subscribe", "/watch/x", "/es/terms", "/terms/x"]) {
      expect(isAppEmbedRequest(path, q("embed=app"))).toBe(false);
    }
  });

  it("needs exactly embed=app", () => {
    expect(isAppEmbedRequest("/terms", q(""))).toBe(false);
    expect(isAppEmbedRequest("/terms", q("embed=1"))).toBe(false);
    expect(isAppEmbedRequest("/terms", q("embed=APP"))).toBe(false);
    expect(isAppEmbedRequest("/terms", q("app=embed"))).toBe(false);
  });
});

describe("withAppEmbed", () => {
  it("appends the parameter the request rule reads", () => {
    expect(withAppEmbed("/privacy")).toBe("/privacy?embed=app");
    expect(withAppEmbed("/es/privacy")).toBe("/es/privacy?embed=app");
    const url = new URL(withAppEmbed("/cookies"), "https://matio.tv");
    expect(isAppEmbedRequest(url.pathname, url.searchParams)).toBe(true);
  });
});
