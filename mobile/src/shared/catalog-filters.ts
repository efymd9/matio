// The Browse tab's filter rules (genre chips, title search), re-exported for
// the app under the same single-relative-path rule as ./design.ts. The module
// is pure and dependency-free; its tests live next to it in lib/ because
// mobile/ has no test runner (docs/mobile-app-plan.md §3).
export * from "../../../lib/catalog-filters";
