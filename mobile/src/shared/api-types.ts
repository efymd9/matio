// The /api/v1 wire contract, re-exported for the app. Same single-relative-path
// rule as ./design.ts.
//
// Importing the server's own type definitions (rather than hand-writing a
// client-side copy) is the whole reason the app is TypeScript: if a route's DTO
// changes shape, the app fails to compile instead of failing at runtime on a
// user's phone that can't be hot-fixed.
export * from "../../../lib/api/types";
