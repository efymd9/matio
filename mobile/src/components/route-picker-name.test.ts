import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// The JS side asks Expo for a native view by name; the Swift module declares
// that name. If the two ever drift, nothing fails at build time — the button
// would just be missing on a device (#451 review). Pin them together.
const requireNativeView = vi.hoisted(() => vi.fn(() => () => null));
vi.mock("expo", () => ({ requireNativeView }));

describe("the AirPlay route picker's native view name (#451)", () => {
  it("is the same in the JS entry and in the Swift module", async () => {
    await import("../../modules/route-picker/src/RoutePickerView.ios");
    const swift = readFileSync(decodeURIComponent(new URL("../../modules/route-picker/ios/RoutePickerModule.swift", import.meta.url).pathname), "utf8");
    const declared = /Name\("([^"]+)"\)/.exec(swift)?.[1];
    expect(declared).toBeTruthy();
    expect(requireNativeView).toHaveBeenCalledWith(declared);
  });
});
