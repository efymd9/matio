// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Loose design references — not part of the app bundle, not linted.
    "example_design/**",
    // Build outputs of the test/Lab toolchain: generated bundles, not our
    // code. `pnpm lab:build` followed by `pnpm lint` otherwise buries the
    // real findings under a few hundred warnings from minified Storybook.
    "coverage/**",
    "storybook-static/**",
    // design-sync (claude.ai/design): рабочее состояние синка — шим тестовых
    // модулей и генерённые превью используют `any` по природе, в бандл
    // приложения ничего из этого не попадает.
    ".design-sync/**",
    // Dot-directories aren't matched by a plain `dir/**` glob, and Expo
    // regenerates these on every build.
    "**/.expo/**",
  ]),
  ...storybook.configs["flat/recommended"]
]);

export default eslintConfig;
