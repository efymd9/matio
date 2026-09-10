/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Clerk's <Show> is the auth branch; the wallet slot lives inside its
// "signed-in" arm. Rendering both arms would hide exactly the bug this suite
// exists to catch, so the mock honours the `when` prop.
vi.mock("@clerk/nextjs", () => ({
  Show: ({
    when,
    children,
  }: {
    when: string;
    children: React.ReactNode;
  }) => (when === "signed-in" ? <>{children}</> : null),
  SignInButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignUpButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

vi.mock("@/lib/posthog-events", () => ({
  capturePostHog: vi.fn(),
  onPostHogReady: vi.fn(() => () => undefined),
}));

// next/dynamic would defer the wallet component past the assertion; render it
// synchronously so "did the paywall mount it at all" is what is measured.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: unknown }>) => {
    void loader;
    return function WalletStub() {
      return <div data-testid="wallet-slot" />;
    };
  },
}));

import { Paywall } from "./paywall";

afterEach(cleanup);

describe("Paywall — the in-place wallet slot (#210)", () => {
  it("mounts nothing wallet-shaped when no publishable key was threaded down", () => {
    // The key is a runtime read gated on WALLET_EXPRESS_CHECKOUT, so null is
    // the state on every deployment where the vertical is dark. Nothing may be
    // mounted then — not a hidden slot, not Stripe.js.
    render(<Paywall showSlug="the-scarlet-oath" walletPublishableKey={null} />);

    expect(screen.queryByTestId("wallet-slot")).toBeNull();
  });

  it("mounts nothing when the prop is omitted entirely", () => {
    // Every pre-existing call site passes no such prop; they must be unchanged.
    render(<Paywall showSlug="the-scarlet-oath" />);

    expect(screen.queryByTestId("wallet-slot")).toBeNull();
  });

  it("mounts the wallet slot for a signed-in viewer once a key is present", () => {
    render(
      <Paywall showSlug="the-scarlet-oath" walletPublishableKey="pk_test_x" />,
    );

    expect(screen.getByTestId("wallet-slot")).toBeTruthy();
  });

  it("keeps the card CTA visible alongside the wallet", () => {
    // Apple's Acceptable Use Guidelines require the wallet to sit ALONGSIDE
    // other payment methods, and a device with no wallet must still be able to
    // pay — so the CTA is never traded away for the button.
    render(
      <Paywall showSlug="the-scarlet-oath" walletPublishableKey="pk_test_x" />,
    );

    const cta = screen.getByRole("link", { name: /subscribe/i });
    expect(cta.getAttribute("href")).toContain("/subscribe?show=the-scarlet-oath");
  });

  it("carries the episode and playhead into the wallet's checkout target", () => {
    // The same params the card CTA carries: without them a new subscriber
    // resumes episode 1 at another episode's playhead.
    render(
      <Paywall
        showSlug="the-scarlet-oath"
        episodeId="ep-3"
        resumeSeconds={128}
        walletPublishableKey="pk_test_x"
      />,
    );

    const href = screen.getByRole("link", { name: /subscribe/i }).getAttribute("href");
    expect(href).toContain("ep=ep-3");
    expect(href).toContain("resume=128");
  });
});
