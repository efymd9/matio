import type { StorybookConfig } from "@storybook/nextjs-vite";

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
};

export default config;
