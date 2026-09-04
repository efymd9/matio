/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/site/purchase-pixel", () => ({
  PurchasePixel: (p: { purchaseKey: string; amountCents: number; currency: string }) => (
    <span data-testid="pp">{`${p.purchaseKey}|${p.amountCents}|${p.currency}`}</span>
  ),
}));

import { PurchaseBeacon } from "./purchase-beacon";

afterEach(cleanup);

describe("PurchaseBeacon", () => {
  it("renders nothing without a verified return", () => {
    const { container } = render(<PurchaseBeacon result={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("hands the verified purchase to the pixel unchanged", () => {
    render(
      <PurchaseBeacon
        result={{ subscriptionId: "sub_9", amountCents: 100, currency: "usd" }}
      />,
    );
    expect(screen.getByTestId("pp").textContent).toBe("sub_9|100|usd");
  });
});
