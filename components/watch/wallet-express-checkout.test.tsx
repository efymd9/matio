/** @vitest-environment jsdom */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Stripe checkout SDK, reduced to what this component actually uses. The
// element is a real <button> so a confirm can be driven from a click, and the
// event handlers are captured so the tests can fire Stripe's own callbacks
// (availability changes, load errors) without a browser.
const stripeMock = vi.hoisted(() => {
  const confirm = vi.fn(async () => ({ type: "success" as const }));
  return {
    confirm,
    handlers: {} as Record<string, (arg: unknown) => void>,
    checkoutState: { type: "success", checkout: { confirm } } as {
      type: string;
      checkout?: { confirm: typeof confirm };
    },
  };
});

vi.mock("@stripe/react-stripe-js/checkout", () => ({
  CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="provider">{children}</div>
  ),
  useCheckoutElements: () => stripeMock.checkoutState,
  ExpressCheckoutElement: (props: Record<string, (arg: unknown) => void>) => {
    stripeMock.handlers = props;
    return (
      <button
        type="button"
        data-testid="ece"
        onClick={() => props.onConfirm({ expressPaymentType: "apple_pay" })}
      >
        Apple Pay
      </button>
    );
  },
}));

const actions = vi.hoisted(() => ({
  createWalletCheckoutSession: vi.fn(async () => ({
    kind: "wallet" as const,
    clientSecret: "cs_secret",
    sessionId: "cs_test_123",
    returnUrl: "https://matio.tv/watch/x?cs=cs_test_123",
  })),
  reportWalletCheckoutStarted: vi.fn(async () => undefined),
}));
vi.mock("@/app/checkout/actions", () => ({
  createWalletCheckoutSession: actions.createWalletCheckoutSession,
}));
vi.mock("@/app/subscribe/actions", () => ({
  reportWalletCheckoutStarted: actions.reportWalletCheckoutStarted,
}));

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

const posthog = vi.hoisted(() => ({ capturePostHog: vi.fn() }));
vi.mock("@/lib/posthog-events", () => posthog);

import { WalletExpressCheckout } from "./wallet-express-checkout";

const PROPS = {
  showSlug: "the-scarlet-oath",
  episodeId: "ep-3",
  resumeSeconds: 128,
  publishableKey: "pk_test_x",
};

beforeEach(() => {
  vi.clearAllMocks();
  stripeMock.checkoutState = {
    type: "success",
    checkout: { confirm: stripeMock.confirm },
  };
  stripeMock.confirm.mockResolvedValue({ type: "success" });
  stripeBrowser.getStripeBrowser.mockResolvedValue({} as unknown);
  actions.createWalletCheckoutSession.mockResolvedValue({
    kind: "wallet",
    clientSecret: "cs_secret",
    sessionId: "cs_test_123",
    returnUrl: "https://matio.tv/watch/x?cs=cs_test_123",
  });
});
afterEach(cleanup);

describe("WalletExpressCheckout — consent gate", () => {
  it("creates NO Stripe session until the buyer ticks the waiver", () => {
    render(<WalletExpressCheckout {...PROPS} />);

    // The wall is shown far more often than it converts; minting a Checkout
    // Session per impression would burn Stripe quota and turn checkout_started
    // into an impression counter.
    expect(actions.createWalletCheckoutSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ece")).toBeNull();
  });

  it("renders the waiver unticked — a pre-ticked consent box is not consent", () => {
    render(<WalletExpressCheckout {...PROPS} />);

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("creates the session once the waiver is ticked, and asserts acceptance to the server", async () => {
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(actions.createWalletCheckoutSession).toHaveBeenCalledWith(
        { show: "the-scarlet-oath", ep: "ep-3", resume: "128" },
        true,
      ),
    );
  });

  it("does not mint a second session when the box is toggled again", async () => {
    render(<WalletExpressCheckout {...PROPS} />);
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByTestId("ece")).toBeTruthy());
    fireEvent.click(box);
    fireEvent.click(box);

    // Stripe's hour-bucketed idempotency key is the backstop, but a changed
    // intent within the hour mints a NEW key — so re-creating here would be a
    // real second session, not a dedupe.
    expect(actions.createWalletCheckoutSession).toHaveBeenCalledTimes(1);
  });
});

describe("WalletExpressCheckout — when there is no wallet surface", () => {
  it("renders no button when the server declines (flag off, webview, anonymous)", async () => {
    actions.createWalletCheckoutSession.mockResolvedValue({
      kind: "unavailable",
    } as never);
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(actions.createWalletCheckoutSession).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("ece")).toBeNull();
  });

  it("renders no button when Stripe.js resolves without a usable key", async () => {
    // The server decides embedded-vs-not from a runtime env read while the
    // client key is build-inlined; when they diverge the element would never
    // initialise and the buyer would stare at a dead slot.
    stripeBrowser.getStripeBrowser.mockResolvedValue(null as unknown);
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(actions.createWalletCheckoutSession).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("ece")).toBeNull();
  });

  it("renders no button when the session action throws", async () => {
    actions.createWalletCheckoutSession.mockRejectedValue(new Error("boom"));
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(actions.createWalletCheckoutSession).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("ece")).toBeNull();
  });

  it("hides itself when the device reports no available wallet", async () => {
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByTestId("ece")).toBeTruthy());

    // `paymentMethods: undefined` is Stripe's signal for "no wallet at all" —
    // no card in Wallet, private browsing, unsupported browser.
    act(() => {
      stripeMock.handlers.onAvailablePaymentMethodsChange({
        paymentMethods: undefined,
      });
    });

    await waitFor(() => expect(screen.queryByTestId("ece")).toBeNull());
  });
});

describe("WalletExpressCheckout — confirming a payment", () => {
  async function arm() {
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByTestId("ece")).toBeTruthy());
  }

  it("reports checkout intent at CONFIRM, keyed on the session id", async () => {
    await arm();
    fireEvent.click(screen.getByTestId("ece"));

    // Meta dedups InitiateCheckout on this id, and the saved PostHog funnel
    // keeps meaning "a buyer intended to pay" rather than "a wall was shown".
    await waitFor(() =>
      expect(actions.reportWalletCheckoutStarted).toHaveBeenCalledWith(
        "cs_test_123",
      ),
    );
    expect(posthog.capturePostHog).toHaveBeenCalledWith(
      "wallet_checkout_confirmed",
      { show_slug: "the-scarlet-oath" },
    );
  });

  it("navigates to the verified return URL on success — never paints access itself", async () => {
    await arm();
    fireEvent.click(screen.getByTestId("ece"));

    // The return leg re-reads the session at Stripe, binds it to this user's
    // customer and runs the idempotent mirror. Trusting the client's success
    // boolean instead would be client-asserted subscription status.
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(
        "https://matio.tv/watch/x?cs=cs_test_123",
      ),
    );
  });

  it("passes the wallet's confirm event straight to Stripe", async () => {
    await arm();
    fireEvent.click(screen.getByTestId("ece"));

    await waitFor(() =>
      expect(stripeMock.confirm).toHaveBeenCalledWith({
        expressCheckoutConfirmEvent: { expressPaymentType: "apple_pay" },
        returnUrl: "https://matio.tv/watch/x?cs=cs_test_123",
      }),
    );
  });

  it("does NOT navigate when the confirm fails", async () => {
    stripeMock.confirm.mockResolvedValue({
      type: "error",
      error: { message: "Card declined" },
    } as never);
    await arm();
    fireEvent.click(screen.getByTestId("ece"));

    await waitFor(() => expect(stripeMock.confirm).toHaveBeenCalled());
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("WalletExpressCheckout — degrading without a scene", () => {
  it("disappears when the Checkout session itself fails to load", async () => {
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByTestId("ece")).toBeTruthy());

    // Reported from an effect, never from render — updating the parent while
    // this component renders is something React rejects outright.
    stripeMock.checkoutState = { type: "error" };
    act(() => {
      stripeMock.handlers.onLoadError({});
    });

    await waitFor(() => expect(screen.queryByTestId("ece")).toBeNull());
  });

  it("disappears when the element reports a load error", async () => {
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByTestId("ece")).toBeTruthy());

    act(() => {
      stripeMock.handlers.onLoadError({ error: { message: "boom" } });
    });

    await waitFor(() => expect(screen.queryByTestId("ece")).toBeNull());
  });

  it("does not treat a cancel that arrives AFTER a confirm as a change of mind", async () => {
    render(<WalletExpressCheckout {...PROPS} />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByTestId("ece")).toBeTruthy());
    fireEvent.click(screen.getByTestId("ece"));
    await waitFor(() => expect(nav.push).toHaveBeenCalled());

    // Stripe documents this ordering for a wallet that resolves inline. The
    // payment already went through; nothing may be re-armed behind it.
    act(() => {
      stripeMock.handlers.onCancel({});
    });

    expect(nav.push).toHaveBeenCalledTimes(1);
  });
});
