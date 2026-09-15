/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The in-site /checkout host. What matters here is the glue around Stripe's
// embedded iframe: which server action is called, what the buyer sees while
// it runs, and — since #217 — that a session expired by a NEWER checkout of
// the same buyer is noticed when the tab comes back into view and replaced by
// the retry prompt instead of a dead form.

vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="provider">{children}</div>
  ),
  EmbeddedCheckout: () => <div data-testid="embedded" />,
}));

const actions = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(async () => ({
    kind: "embedded" as const,
    clientSecret: "cs_test_1_secret",
    sessionId: "cs_test_1",
  })),
  checkoutSessionState: vi.fn(async () => "open" as "open" | "closed"),
}));
vi.mock("@/app/checkout/actions", () => actions);

const stripeBrowser = vi.hoisted(() => ({
  getStripeBrowser: vi.fn(async () => ({}) as unknown),
}));
vi.mock("@/lib/stripe-browser", () => stripeBrowser);

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

vi.mock("@/lib/i18n/client", async () => {
  const { en } = await import("@/lib/i18n/dictionaries");
  return { useT: () => en };
});

import { CheckoutClient } from "./checkout-client";

const PROPS = {
  show: "the-scarlet-oath",
  ep: "ep-3",
  resume: "128",
  publishableKey: "pk_test_x",
};

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function focusWindow() {
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
}

// The probe listeners are attached from an effect that runs AFTER the render
// in which the iframe first appears. Waiting for the iframe alone therefore
// leaves a window in which an event dispatched by the test is simply missed
// (it did, in CI). Wait for the registration itself instead — deterministic
// on any machine, no reliance on microtask ordering.
const listeners = {
  document: vi.spyOn(document, "addEventListener"),
  window: vi.spyOn(window, "addEventListener"),
};

async function mountLiveForm() {
  render(<CheckoutClient {...PROPS} />);
  await waitFor(() => expect(screen.getByTestId("embedded")).toBeTruthy());
  await vi.waitFor(() => {
    expect(listeners.document).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(listeners.window).toHaveBeenCalledWith("focus", expect.any(Function));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.createCheckoutSession.mockResolvedValue({
    kind: "embedded",
    clientSecret: "cs_test_1_secret",
    sessionId: "cs_test_1",
  });
  actions.checkoutSessionState.mockResolvedValue("open");
  stripeBrowser.getStripeBrowser.mockResolvedValue({} as unknown);
});
afterEach(() => {
  cleanup();
  setVisibility("visible");
});

describe("CheckoutClient — mounting", () => {
  it("creates one session for the watch target and mounts the embedded form", async () => {
    await mountLiveForm();

    expect(actions.createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(actions.createCheckoutSession).toHaveBeenCalledWith({
      show: "the-scarlet-oath",
      ep: "ep-3",
      resume: "128",
    });
    expect(screen.getByTestId("provider")).toBeTruthy();
  });

  it("follows a guard bounce with router.replace and mounts nothing", async () => {
    actions.createCheckoutSession.mockResolvedValue({
      kind: "redirect",
      to: "/",
    } as never);
    render(<CheckoutClient {...PROPS} />);

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByTestId("embedded")).toBeNull();
  });

  it("shows the retry prompt when the session cannot be created", async () => {
    actions.createCheckoutSession.mockRejectedValue(new Error("boom"));
    render(<CheckoutClient {...PROPS} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy(),
    );
    expect(screen.getByText(/couldn't load checkout/i)).toBeTruthy();
  });
});

describe("CheckoutClient — a session expired by a newer checkout (#217)", () => {
  it("asks whether its session is still open when the tab comes back into view", async () => {
    await mountLiveForm();

    setVisibility("hidden");
    setVisibility("visible");

    await vi.waitFor(() =>
      expect(actions.checkoutSessionState).toHaveBeenCalledWith("cs_test_1"),
    );
  });

  it("asks again when the window regains focus — the tab that never left the screen", async () => {
    // Two same-instant creates can expire EACH OTHER: both tabs hold a dead
    // secret, and the one the buyer is looking at never gets a
    // visibilitychange. Clicking back into it is the only signal left.
    await mountLiveForm();

    focusWindow();

    await vi.waitFor(() =>
      expect(actions.checkoutSessionState).toHaveBeenCalledWith("cs_test_1"),
    );
  });

  it("replaces a dead form with the retry prompt, in words that say what happened", async () => {
    // The buyer opened /checkout, went to the player and ticked the wallet
    // box — that newer checkout expired this one. Stripe's iframe gives no
    // signal for that; without the probe the buyer would fill in a card on a
    // form that can no longer take it.
    await mountLiveForm();
    actions.checkoutSessionState.mockResolvedValue("closed");

    setVisibility("hidden");
    setVisibility("visible");

    await vi.waitFor(() => expect(screen.queryByTestId("embedded")).toBeNull());
    expect(screen.getByText(/started a newer one/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    // No silent re-creation: that would in turn expire the checkout the buyer
    // is presumably paying in elsewhere. The retry is the buyer's click.
    expect(actions.createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("leaves a live form alone when the probe answers open", async () => {
    await mountLiveForm();

    setVisibility("hidden");
    setVisibility("visible");

    await vi.waitFor(() =>
      expect(actions.checkoutSessionState).toHaveBeenCalledWith("cs_test_1"),
    );
    // Let the resolved "open" land before asserting the form survived it.
    await act(async () => {});
    expect(screen.getByTestId("embedded")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("does not probe while the tab is hidden", async () => {
    await mountLiveForm();

    setVisibility("hidden");

    await act(async () => {});
    expect(actions.checkoutSessionState).not.toHaveBeenCalled();
  });

  it("does not probe before a session is mounted", async () => {
    actions.createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<CheckoutClient {...PROPS} />);

    setVisibility("hidden");
    setVisibility("visible");
    focusWindow();

    await act(async () => {});
    expect(actions.checkoutSessionState).not.toHaveBeenCalled();
  });
});
