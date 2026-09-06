import { describe, expect, it } from "vitest";

import { SHIMMED_MODULES, underVitest, withLabTestShim } from "./test-shim-alias";

const SHIM = "/repo/tools/lab/test-shim.ts";

describe("withLabTestShim", () => {
  it("leaves the alias config untouched under vitest (goldens stay real)", () => {
    const alias = [{ find: "@", replacement: "/repo" }];
    expect(withLabTestShim(alias, SHIM, { VITEST: "true" })).toBe(alias);
    expect(withLabTestShim(undefined, SHIM, { VITEST: "true" })).toBeUndefined();
  });

  it("maps bare `vitest` — and nothing else — to the shim outside vitest", () => {
    const result = withLabTestShim(undefined, SHIM, {}) as {
      find: RegExp;
      replacement: string;
    }[];
    expect(result).toHaveLength(SHIMMED_MODULES.length);
    expect(result[0].replacement).toBe(SHIM);
    expect(result[0].find.test("vitest")).toBe(true);
    expect(result[0].find.test("vitest/config")).toBe(false);
    expect(result[0].find.test("storybook/test")).toBe(false);
    expect(result[0].find.test("@vitest/expect")).toBe(false);
  });

  it("keeps existing aliases after the shim, in both Vite shapes", () => {
    const fromArray = withLabTestShim(
      [{ find: "@", replacement: "/repo" }],
      SHIM,
      {},
    );
    expect(fromArray).toEqual([
      { find: SHIMMED_MODULES[0], replacement: SHIM },
      { find: "@", replacement: "/repo" },
    ]);

    const fromObject = withLabTestShim({ "@": "/repo" }, SHIM, {});
    expect(fromObject).toEqual([
      { find: SHIMMED_MODULES[0], replacement: SHIM },
      { find: "@", replacement: "/repo" },
    ]);
  });

  it("treats any set VITEST value as the runner — erring towards real modules", () => {
    expect(underVitest({ VITEST: "true" })).toBe(true);
    expect(underVitest({ VITEST: "1" })).toBe(true);
    expect(underVitest({})).toBe(false);
    expect(underVitest({ VITEST: "" })).toBe(false);
  });
});
