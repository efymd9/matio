const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// The app imports a handful of UNIVERSAL modules straight out of the web app's
// lib/ — design tokens and the /api/v1 wire types (see src/shared/). Metro only
// watches the project root by default, so those paths must be declared or a
// cold start can't resolve them and edits won't trigger a reload.
config.watchFolders = [path.join(repoRoot, "lib")];

// Pin resolution to the app's OWN node_modules and stop Metro walking up the
// tree. mobile/ is deliberately NOT a pnpm workspace member (docs/
// mobile-app-plan.md §3): the repo root has its own react/react-dom for Next,
// and hierarchical lookup would happily load a second copy of React into the
// bundle.
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
