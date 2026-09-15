// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { fixupPluginRules } from "@eslint/compat";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ESLint 10 removed the deprecated rule-context members (context.getFilename(),
// getSourceCode(), parserOptions, …) and three plugins that eslint-config-next
// composes still call them — their peer ranges stop at ESLint 9 and none has
// an ESLint-10 release: eslint-plugin-react 7.37.5 (2025-04; upstream #3977
// open), eslint-plugin-jsx-a11y 6.10.2 (2024-10; #1075 open),
// eslint-plugin-import 2.32.0 (2025-06). Without this, `react/display-name`
// crashes on the first file (`contextOrFilename.getFilename is not a
// function`). @eslint/compat's fixup puts exactly those members back on the
// rule context; the rule set and its levels are untouched (#157, part 2).
// Drop the shim once eslint-config-next depends on ESLint-10-native versions
// of the three — tracked in docs/registry.md.
const LEGACY_PLUGINS = new Set(["react", "jsx-a11y", "import"]);

function fixupLegacyPlugins(configs) {
  return configs.map((config) =>
    config.plugins
      ? {
          ...config,
          plugins: Object.fromEntries(
            Object.entries(config.plugins).map(([name, plugin]) => [
              name,
              LEGACY_PLUGINS.has(name) ? fixupPluginRules(plugin) : plugin,
            ]),
          ),
        }
      : config,
  );
}

const eslintConfig = defineConfig([
  ...fixupLegacyPlugins([...nextVitals, ...nextTs]),
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
    ".ds-sync/**",
    "ds-bundle/**",
    // Dot-directories aren't matched by a plain `dir/**` glob, and Expo
    // regenerates these on every build.
    "**/.expo/**",
    "design_handoff_matio_redesign/**",
    // The Expo app is a standalone project with its own toolchain and lint
    // config; the Next/web rules here don't apply to React Native source.
    "mobile/**",
    // Agent worktrees live INSIDE the repo tree (.claude/worktrees/<agent>/):
    // without this, `pnpm lint` from the main checkout scans a parallel
    // session's copy — its generated Storybook shims included — and fails on
    // code that is not ours. CI never has worktrees; this is for humans.
    ".claude/worktrees/**",
  ]),
  ...storybook.configs["flat/recommended"]
]);

export default eslintConfig;
