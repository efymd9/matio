import { afterEach, describe, expect, it, vi } from "vitest";

// #288 item 6 — APP_BUILD is what /v1/config's minSupportedBuild is compared
// against: the ONE lever that retires a broken binary. It used to be a literal
// 1 in every build, so raising the floor to 2 walled every tester (build 6
// included) and any lower value did nothing. It is now the native build
// number EAS stamps (Constants.nativeBuildVersion), the one Settings shows.

const native = vi.hoisted(() => ({ nativeBuildVersion: null as string | null }));
vi.mock("expo-constants", () => ({ default: native }));

async function appBuild(nativeBuildVersion: string | null) {
  native.nativeBuildVersion = nativeBuildVersion;
  vi.resetModules();
  return (await import("./build")).APP_BUILD;
}

afterEach(() => {
  native.nativeBuildVersion = null;
});

describe("APP_BUILD", () => {
  it("is the native build number EAS stamped on the binary", async () => {
    expect(await appBuild("6")).toBe(6);
    expect(await appBuild("42")).toBe(42);
  });

  it("falls back to 1 where there is no numeric native build", async () => {
    expect(await appBuild(null)).toBe(1);
    expect(await appBuild("")).toBe(1);
    expect(await appBuild("dev")).toBe(1);
  });
});
