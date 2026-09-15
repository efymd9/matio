import { describe, expect, it } from "vitest";

import {
  CheckoutOriginError,
  checkoutOrigin,
  resolveCheckoutOrigin,
} from "./checkout-origin";

// The return URL is used AFTER the card is charged, so the two failures are
// not symmetric: a wrong origin costs a paying customer their confirmation
// page, while a refusal costs nothing but a retry. #202 came from the bench
// silently returning localhost to a real buyer.
describe("resolveCheckoutOrigin", () => {
  it("prefers the explicit variable over anything the platform offers", () => {
    expect(
      resolveCheckoutOrigin({
        appUrl: "https://matio.tv",
        onVercel: "1",
        projectProductionUrl: "matio-staging.vercel.app",
        deploymentUrl: "matio-abc123.vercel.app",
      }),
    ).toBe("https://matio.tv");
  });

  it("falls to the project's production host when the variable is missing", () => {
    expect(
      resolveCheckoutOrigin({
        onVercel: "1",
        projectProductionUrl: "matio-staging.vercel.app",
        deploymentUrl: "matio-abc123.vercel.app",
      }),
    ).toBe("https://matio-staging.vercel.app");
  });

  it("falls to this deployment's own host on a preview", () => {
    expect(
      resolveCheckoutOrigin({
        onVercel: "1",
        deploymentUrl: "matio-abc123.vercel.app",
      }),
    ).toBe("https://matio-abc123.vercel.app");
  });

  it("REFUSES on a deployment with nothing usable — no charge, rather than a charge into nowhere", () => {
    expect(() => resolveCheckoutOrigin({ onVercel: "1" })).toThrow(
      CheckoutOriginError,
    );
    expect(() =>
      resolveCheckoutOrigin({ onVercel: "1", appUrl: "   " }),
    ).toThrow(CheckoutOriginError);
  });

  it("allows localhost only off the platform — a developer's own machine", () => {
    expect(resolveCheckoutOrigin({})).toBe("http://localhost:3000");
    expect(resolveCheckoutOrigin({ appUrl: "" })).toBe("http://localhost:3000");
  });

  it("keeps only the origin, dropping a path, query or trailing slash", () => {
    expect(resolveCheckoutOrigin({ appUrl: "https://matio.tv/" })).toBe(
      "https://matio.tv",
    );
    expect(resolveCheckoutOrigin({ appUrl: "https://matio.tv/subscribe?a=1" })).toBe(
      "https://matio.tv",
    );
  });

  it("accepts a local http origin but rejects a nonsense value", () => {
    expect(resolveCheckoutOrigin({ appUrl: "http://localhost:3001" })).toBe(
      "http://localhost:3001",
    );
    // Not http(s): a typo like this must not become the return URL.
    expect(() =>
      resolveCheckoutOrigin({ onVercel: "1", appUrl: "ftp://matio.tv" }),
    ).toThrow(CheckoutOriginError);
    expect(() =>
      resolveCheckoutOrigin({ onVercel: "1", appUrl: "https://" }),
    ).toThrow(CheckoutOriginError);
  });

  it("skips a broken candidate and takes the next usable one", () => {
    expect(
      resolveCheckoutOrigin({
        appUrl: "not a url at all ///",
        onVercel: "1",
        projectProductionUrl: "matio-staging.vercel.app",
      }),
    ).toBe("https://matio-staging.vercel.app");
  });
});

describe("checkoutOrigin — the environment wrapper", () => {
  it("answers from the environment without throwing in a local run", () => {
    // No VERCEL marker in the test environment, so the localhost branch is
    // the honest answer here; the point is that the wrapper wires the same
    // rule the pure function was tested on.
    expect(checkoutOrigin()).toMatch(/^https?:\/\//);
  });
});
