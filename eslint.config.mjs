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
    // Coverage output (vitest): generated reporters, not our code.
    "coverage/**",
    // Dot-directories aren't matched by a plain `dir/**` glob, and Expo
    // regenerates these on every build.
    "**/.expo/**",
  ]),
]);

export default eslintConfig;
