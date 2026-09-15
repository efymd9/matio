import { describe, expect, it } from "vitest";

import {
  buildCheckoutReturnUrl,
  parseCheckoutSessionParam,
  withCheckoutSessionId,
} from "./checkout-return";

describe("buildCheckoutReturnUrl", () => {
  it("appends the session placeholder to a watch path with or without a query", () => {
    expect(
      buildCheckoutReturnUrl("https://matio.tv", "/watch/the-scarlet-oath?ep=abc"),
    ).toBe("https://matio.tv/watch/the-scarlet-oath?ep=abc&cs={CHECKOUT_SESSION_ID}");
    expect(buildCheckoutReturnUrl("https://matio.tv", "/watch/morelli")).toBe(
      "https://matio.tv/watch/morelli?cs={CHECKOUT_SESSION_ID}",
    );
  });

  it("falls back to the home welcome return when checkout had no show target", () => {
    expect(buildCheckoutReturnUrl("https://matio.tv", null)).toBe(
      "https://matio.tv/?welcome=1&cs={CHECKOUT_SESSION_ID}",
    );
  });
});

describe("parseCheckoutSessionParam", () => {
  it("accepts only a Stripe-shaped session id", () => {
    expect(parseCheckoutSessionParam("cs_test_a1B2_c3")).toBe("cs_test_a1B2_c3");
    expect(parseCheckoutSessionParam("cs_live_x")).toBe("cs_live_x");
  });

  it("rejects anything else — arrays, junk, injection attempts", () => {
    expect(parseCheckoutSessionParam(undefined)).toBeNull();
    expect(parseCheckoutSessionParam(["cs_a"])).toBeNull();
    expect(parseCheckoutSessionParam("sub_123")).toBeNull();
    expect(parseCheckoutSessionParam("cs_<script>")).toBeNull();
    expect(parseCheckoutSessionParam("")).toBeNull();
  });
});

describe("withCheckoutSessionId", () => {
  // The paywall's wallet button confirms in the browser with
  // `redirect: 'if_required'`, so on an inline success there is no Stripe
  // redirect to substitute the placeholder — the server does it (#210).
  it("substitutes the placeholder Stripe would have substituted", () => {
    const url = buildCheckoutReturnUrl(
      "https://matio.tv",
      "/watch/the-scarlet-oath?ep=e1",
    );

    expect(withCheckoutSessionId(url, "cs_test_abc123")).toBe(
      "https://matio.tv/watch/the-scarlet-oath?ep=e1&cs=cs_test_abc123",
    );
  });

  it("produces a value the return-leg verifier will still accept", () => {
    const url = withCheckoutSessionId(
      buildCheckoutReturnUrl("https://matio.tv", null),
      "cs_live_xyz",
    );
    const cs = new URL(url).searchParams.get("cs");

    // The shape check is the first gate in lib/checkout-return-verify.ts; a
    // baked-in id must pass it exactly like a Stripe-substituted one.
    expect(parseCheckoutSessionParam(cs)).toBe("cs_live_xyz");
  });

  it("leaves a url with no placeholder untouched", () => {
    expect(
      withCheckoutSessionId("https://matio.tv/watch/x", "cs_test_1"),
    ).toBe("https://matio.tv/watch/x");
  });
});
