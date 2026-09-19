// The Home feed's rules (what sits under the carousel, in which order, with
// which badge — #248), re-exported for the app under the same
// single-relative-path rule as ./catalog-filters.ts. The module is pure —
// its only imports are wire types — and its tests live next to it in lib/
// because mobile/ has no test runner (docs/mobile-app-plan.md §3).
export * from "../../../lib/home-feed";
