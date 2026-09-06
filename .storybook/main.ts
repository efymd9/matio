import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/nextjs-vite";

// Explicit `.ts`: Storybook loads this file with Node's own TypeScript
// loader, which does not resolve extensionless relative imports (the
// `allowImportingTsExtensions` flag in tsconfig exists for this line).
import { withLabTestShim } from "../tools/lab/test-shim-alias.ts";

const testShim = fileURLToPath(
  new URL("../tools/lab/test-shim.ts", import.meta.url),
);

// Stories live NEXT TO the components they demonstrate (components/**), not in
// a parallel stories/ tree: a component whose story sits three directories away
// gets edited without its story, and the Lab rots. `lab/` holds the gallery's
// own pages — the token sheet and any Lab-first variant boards.
const config: StorybookConfig = {
  stories: [
    "../components/**/*.stories.@(ts|tsx)",
    "../lab/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-mcp",
  ],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],

  // This config is loaded by three processes: `storybook dev`, `storybook
  // build` and vitest's Storybook plugin. Only the last has a vitest runtime
  // for `lab/golden.ts` to `import { expect } from "vitest"` against — in the
  // other two that import throws at module load and kills every story that
  // imports golden (#78). Outside vitest (`process.env.VITEST` unset) the bare
  // `vitest` specifier is aliased to an inert shim; under vitest nothing is
  // touched. `storybook/test` is deliberately NOT shimmed — it works in a plain
  // preview. See tools/lab/test-shim.ts and test-shim-alias.ts.
  viteFinal: async (viteConfig) => {
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = withLabTestShim(
      viteConfig.resolve.alias,
      testShim,
    );
    return viteConfig;
  },
};

export default config;
