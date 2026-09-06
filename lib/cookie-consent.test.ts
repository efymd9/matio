/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { clearMarketingCookies } from "./cookie-consent";

afterEach(() => {
  for (const name of ["attribution_first", "_fbp", "muxData", "cookie_consent"]) {
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

describe("clearMarketingCookies", () => {
  it("expires the Mux Data viewer cookie with the rest of the marketing set, and only those", () => {
    // What a consented visit leaves behind: our attribution pair, the Meta
    // browser id, and mux-embed's `muxData` (listed under Marketing on
    // /cookies — issue #127 found withdrawal leaving it in place).
    for (const name of ["attribution_first", "_fbp", "muxData"]) {
      document.cookie = `${name}=x; path=/`;
    }
    document.cookie = "cookie_consent=keep; path=/";
    expect(document.cookie).toContain("muxData=x");

    clearMarketingCookies();

    expect(document.cookie).not.toContain("muxData=");
    expect(document.cookie).not.toContain("_fbp=");
    expect(document.cookie).not.toContain("attribution_first=");
    // The consent record itself is strictly necessary and must survive.
    expect(document.cookie).toContain("cookie_consent=keep");
  });
});
