import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// The guard for #266. stripe-node sends whatever API version is baked into the
// INSTALLED package unless the constructor is told otherwise — so a routine
// minor SDK bump can change the version on the wire without a line of our code
// moving. That is how `ui_mode` values were renamed under us once
// (`embedded` → `embedded_page`). Two facts are pinned here:
//
//   1. the version baked into the installed SDK === STRIPE_API_VERSION, read
//      from the package's own public static `Stripe.API_VERSION` (typed as the
//      literal, assigned from the generated apiVersion.js) — no file parsing,
//      no network;
//   2. getStripe() really hands that constant to the constructor — without
//      this, deleting `{ apiVersion }` would silently un-pin the client while
//      (1) stayed green, because the SDK's default is the same string.
//
// RED on an SDK bump is the point, not a nuisance: read the changelog of the
// new API version, rehearse checkout on staging, then move the literal in
// lib/stripe.ts (docs/gotchas.md → "Stripe API 2024+ moves").

const h = vi.hoisted(() => ({ constructed: [] as unknown[][] }));

vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  // A recording SUBCLASS, not a stub: the statics (API_VERSION) and the whole
  // client stay the SDK's own; only the constructor arguments are noted.
  class RecordingStripe extends actual.default {
    constructor(...args: ConstructorParameters<typeof actual.default>) {
      h.constructed.push(args);
      super(...args);
    }
  }
  return { ...actual, default: RecordingStripe };
});

import { STRIPE_API_VERSION, getStripe } from "./stripe";

afterEach(() => {
  // getStripe() caches on globalThis — a leaked client would make the next
  // case read a constructor call that never happened.
  globalThis.__stripeClient = undefined;
  h.constructed.length = 0;
  vi.unstubAllEnvs();
});

describe("Stripe API version pin (#266)", () => {
  it("the version baked into the installed SDK is the one we pinned", () => {
    expect(Stripe.API_VERSION).toBe(STRIPE_API_VERSION);
  });

  it("the pin is a dated Stripe version string, not a placeholder", () => {
    // Guards the literal's SHAPE, so an empty or mistyped constant cannot
    // agree with a broken read on the other side of the equality above.
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/);
  });

  it("getStripe() hands the pin to the constructor and it reaches the wire field", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_dummy");

    const client = getStripe();

    expect(h.constructed).toHaveLength(1);
    expect(h.constructed[0]).toEqual([
      "sk_test_dummy",
      { apiVersion: STRIPE_API_VERSION },
    ]);
    // What the SDK will put in the Stripe-Version header.
    expect(client.getApiField("version")).toBe(STRIPE_API_VERSION);
  });

  it("still refuses to build a client without a secret", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");

    expect(() => getStripe()).toThrow("STRIPE_SECRET_KEY must be set");
    expect(h.constructed).toHaveLength(0);
  });
});
