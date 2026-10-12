import { en, type Dict } from "./dictionaries";

// The website's copy for client components. English only since #445
// (2026-10-12) — there is no locale to carry through context any more, so no
// provider either: this hands back the one dictionary the site renders (the
// server side is lib/i18n/server.ts:getDict). The name stays so the many
// call sites do not change.
export function useT(): Dict {
  return en;
}
