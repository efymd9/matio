"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  dictFor,
  type Dict,
  type Locale,
} from "./dictionaries";

// We only thread the locale string through React context. Each component
// resolves the dictionary itself by calling dictFor(locale), so the dict
// (which contains functions for pluralisation / interpolation) never has
// to cross the server→client serialisation boundary.
const LocaleCtx = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleCtx.Provider value={locale}>{children}</LocaleCtx.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleCtx);
}

export function useT(): Dict {
  return dictFor(useContext(LocaleCtx));
}
