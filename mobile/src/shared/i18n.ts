// The web's public dictionaries (en, plus es for the sections the app shares —
// the site itself is English-only since #445), the app-only copy, and the
// pure locale-matching rules — re-exported for the app under the same
// single-relative-path rule as ./design.ts and ./api-types.ts.
//
// All three modules are genuinely universal: dictionaries.ts has no imports at
// all, app-dictionaries.ts imports only a type, negotiate.ts imports only
// dictionaries.ts. The site's server half (lib/i18n/server.ts) is
// deliberately NOT re-exported — it is "server-only" and would break the
// bundle.
export * from "../../../lib/i18n/dictionaries";
export * from "../../../lib/i18n/app-dictionaries";
export { matchSupportedTag, pickFromLanguageTags } from "../../../lib/i18n/negotiate";
