// The web's public dictionary and the app-only copy — English only since
// #447 — re-exported for the app under the same single-relative-path rule as
// ./design.ts and ./api-types.ts.
//
// Both modules are genuinely universal: neither imports anything. The site's
// server half (lib/i18n/server.ts) is deliberately NOT re-exported — it is
// "server-only" and would break the bundle.
export * from "../../../lib/i18n/dictionaries";
export * from "../../../lib/i18n/app-dictionaries";
