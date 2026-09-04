import { describe, expect, it } from "vitest";

import {
  buildCheckoutReturnUrl,
  parseCheckoutSessionParam,
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
