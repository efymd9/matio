import { describe, expect, it } from "vitest";

import { resolveAnalyticsView } from "./admin-analytics-view";

describe("resolveAnalyticsView", () => {
  it("renders the retention dashboard by default in both modes", () => {
    expect(resolveAnalyticsView(false, undefined)).toBe("v2");
    expect(resolveAnalyticsView(true, undefined)).toBe("v2");
  });

  it("exposes the legacy dashboard only in paid mode, only on request", () => {
    expect(resolveAnalyticsView(true, "legacy")).toBe("legacy");
    expect(resolveAnalyticsView(true, ["legacy"])).toBe("legacy");
    // Free mode: the legacy paid panels would be zeros — the switch is inert.
    expect(resolveAnalyticsView(false, "legacy")).toBe("v2");
    expect(resolveAnalyticsView(true, "anything-else")).toBe("v2");
  });
});
