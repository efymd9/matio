// Вариант конфига стенда ТОЛЬКО для reference-сборки design-sync.
// Отличие от боевого .storybook/main.ts: убраны @storybook/addon-vitest и
// @chromatic-com/storybook — с ними статическая сборка мертва в чистом
// браузере (storybook/test инициализирует vitest-expect, которого нет вне
// раннера: «Cannot read properties of undefined (customEqualityTesters)»).
// Боевой стенд это не задевает — он живёт под vitest. Известная грабля
// зафиксирована в .design-sync/NOTES.md.
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/nextjs-vite";

const shim = fileURLToPath(new URL("./test-shim.ts", import.meta.url));

const config: StorybookConfig = {
  stories: [
    "../../components/**/*.stories.@(ts|tsx)",
    "../../lab/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../../public"],
  // Подмена тестовых модулей на инертную заглушку — см. test-shim.ts.
  viteFinal: async (config) => {
    config.resolve ??= {};
    const alias = config.resolve.alias;
    const entries = [
      { find: /^storybook\/test$/, replacement: shim },
      { find: /^vitest$/, replacement: shim },
    ];
    config.resolve.alias = Array.isArray(alias)
      ? [...entries, ...alias]
      : [...entries, ...Object.entries(alias ?? {}).map(([find, replacement]) => ({ find, replacement }))];
    return config;
  },
};

export default config;
