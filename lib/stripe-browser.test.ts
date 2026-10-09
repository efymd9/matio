/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { STRIPE_API_VERSION } from "./stripe";
import { getStripeBrowser } from "./stripe-browser";

// The browser half of the #266 pin (#433). The server talks to Stripe on
// STRIPE_API_VERSION (`<date>.<train>`, held to the server SDK by
// lib/stripe-api-version.test.ts); the browser runs whichever Stripe.js
// @stripe/stripe-js loads — since v6 each major of that package is welded to
// ONE release train (`js.stripe.com/<train>/stripe.js`), and Stripe.js makes
// its own API calls on that train with no way to override it. Stripe's advice
// is to keep the two on the same train: Embedded Checkout and the wallet's
// ExpressCheckoutElement render a Checkout Session the server created, and the
// breaking changes of a train land in BOTH halves (Endive: `canConfirm`,
// address validation, the payment request button). The SDKs move in separate
// packages, so a split upgrade — `stripe` bumped, `@stripe/stripe-js` left
// behind, or the other way round — is one Dependabot group away; this is what
// turns it red.
//
// It reads the script tag loadStripe really injects (jsdom fetches nothing),
// not the package's private constant.

describe("Stripe.js release train", () => {
  it("the browser loads Stripe.js from the server API version's train", () => {
    void getStripeBrowser("pk_test_dummy");

    const script = document.querySelector<HTMLScriptElement>(
      'script[src^="https://js.stripe.com/"]',
    );
    expect(script).not.toBeNull();
    const browserTrain = script!.src.match(
      /^https:\/\/js\.stripe\.com\/([a-z]+)\/stripe\.js/,
    )?.[1];
    const serverTrain = STRIPE_API_VERSION.split(".")[1];

    expect(browserTrain).toBeTruthy();
    expect(browserTrain).toBe(serverTrain);
  });
});
