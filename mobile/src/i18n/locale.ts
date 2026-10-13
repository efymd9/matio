import { appEn, en, type AppDict, type Dict } from "@/shared/i18n";

// The app's copy: the web's public dictionary (lib/i18n/dictionaries.ts —
// rails, walls, player labels) plus the app-only strings under `app`.
//
// English only since #447 (2026-10-12; the owner: «убери испанский из мобилки
// пока»), after the website (#445). There is nothing to resolve any more: the
// device language is not read, and there is no choice to store — builds
// before #447 kept one in SecureStore under `matio_locale`; this one never
// reads or writes that key, so on a phone that has it, it simply stays
// unread (a two-letter preference, see the /gdpr data map).
export type AppT = Dict & { app: AppDict };

const T: AppT = { ...en, app: appEn };

// The one way every screen reads its copy. Hook-shaped for the call sites
// it has always had; it reads no context, so it answers the same anywhere —
// including the last-resort error boundary outside every provider
// (components/route-error.tsx).
export function useT(): AppT {
  return T;
}
