/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://www.matio.tv/watch/some-show"}
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearMarketingCookies } from "./cookie-consent";

// On the real host the SDKs write their cookies on the REGISTRABLE domain
// (GA4's `_ga` / `_ga_<container>` by its automatic cookie_domain, PostHog's
// `ph_<key>_posthog` cross-subdomain, Meta's `_fbp`), which a host-only
// deletion does not reach. jsdom runs this file on www.matio.tv so the
// domain-scoped half of clearMarketingCookies is exercised for real.
const DOMAIN_SCOPED = ["_ga", "_ga_9FS22EEF6K", "ph_phc_test_posthog", "_fbp"];

afterEach(() => {
  for (const name of [...DOMAIN_SCOPED, "matio_aid"]) {
    document.cookie = `${name}=; max-age=0; path=/; domain=.matio.tv`;
    document.cookie = `${name}=; max-age=0; path=/`;
  }
});

describe("clearMarketingCookies on www.matio.tv (#466)", () => {
  it("expires GA4, PostHog and Meta cookies set on .matio.tv — and keeps the necessary ones", () => {
    for (const name of DOMAIN_SCOPED) {
      document.cookie = `${name}=geo-default-era; path=/; domain=.matio.tv`;
    }
    document.cookie = "matio_aid=keep; path=/; domain=.matio.tv";
    for (const name of DOMAIN_SCOPED) {
      expect(document.cookie, name).toContain(`${name}=geo-default-era`);
    }

    clearMarketingCookies();

    const held = document.cookie.split("; ").map((pair) => pair.split("=")[0]);
    for (const name of DOMAIN_SCOPED) {
      expect(held, name).not.toContain(name);
    }
    expect(held).toContain("matio_aid");
  });

  it("matches the patterned names only: a cookie that merely starts like one stays", () => {
    document.cookie = "_gaming=keep; path=/";
    document.cookie = "ph_note=keep; path=/";

    clearMarketingCookies();

    expect(document.cookie).toContain("_gaming=keep");
    expect(document.cookie).toContain("ph_note=keep");
    document.cookie = "_gaming=; max-age=0; path=/";
    document.cookie = "ph_note=; max-age=0; path=/";
  });
});
