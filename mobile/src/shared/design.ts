// The web app's design tokens, re-exported for the app.
//
// This file exists so exactly ONE place holds the relative path across the
// project boundary. When mobile/ eventually becomes a workspace package and
// lib/design.ts moves to packages/shared, only this line changes — no app code
// touches the path. Metro is told to watch ../lib in metro.config.js.
//
// lib/design.ts is safe to import here because it is genuinely universal: zero
// imports, no `server-only`, no next/*. Do not extend this re-export to modules
// that aren't.
export * from "../../../lib/design";
