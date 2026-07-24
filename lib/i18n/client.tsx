"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  dictFor,
  type Dict,
  type Locale,
} from "./dictionaries";
import { setLocale as setLocaleAction } from "./actions";
import { LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME } from "./shared";
import {
  isLocalizablePath,
  localizedPath,
  stripLocalePrefix,
} from "@/lib/seo";

// We thread the locale string + a setter through React context. Each
// component resolves the dictionary itself by calling dictFor(locale),
// so the dict (which contains functions for pluralisation /
// interpolation) never has to cross the server→client serialisation
// boundary.
type Ctx = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  isPending: boolean;
};

const LocaleCtx = createContext<Ctx>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  isPending: false,
});

export function LocaleProvider({
  locale: initialLocale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // State, not just context value, so the language switcher can flip
  // the locale optimistically. Every consumer of useLocale / useT
  // re-renders instantly with the new dictionary; the server cookie +
  // revalidate happens in the background.
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [isPending, setIsPending] = useState(false);

  // Reconcile if the server later re-renders the tree with a different
  // locale (e.g. another tab flipped the cookie and a refresh streamed
  // through new layout RSC). Adjust state during render rather than in
  // an effect — the React 19 idiom for "reset state when a prop
  // changes" (avoids the cascading render that
  // react-hooks/set-state-in-effect flags).
  const [lastInitialLocale, setLastInitialLocale] =
    useState<Locale>(initialLocale);
  if (lastInitialLocale !== initialLocale) {
    setLastInitialLocale(initialLocale);
    setLocaleState(initialLocale);
  }

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      if (!(SUPPORTED_LOCALES as readonly string[]).includes(next)) return;
      setLocaleState(next);
      setIsPending(true);
      // Mirror to the client-readable cookie immediately so even if the
      // server action's Set-Cookie response somehow loses, the next
      // server render reads the new value. The cookie is httpOnly:false
      // by design (see lib/i18n/actions.ts).
      document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      // On an indexable public page the locale lives in the URL (bare = en,
      // /es = es), so switching must NAVIGATE — a bare refresh would leave an
      // /es URL rendering Spanish regardless of the new cookie (the URL wins
      // in getLocale). Elsewhere (/watch, /subscribe) the cookie alone drives
      // it, so refresh in place.
      const { path: base } = stripLocalePrefix(pathname);
      const target = isLocalizablePath(base) ? localizedPath(base, next) : null;
      setLocaleAction(next)
        .then(() => {
          if (target && target !== pathname) router.push(target);
          else router.refresh();
        })
        .finally(() => setIsPending(false));
    },
    [locale, pathname, router],
  );

  return (
    <LocaleCtx.Provider value={{ locale, setLocale, isPending }}>
      {children}
    </LocaleCtx.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleCtx).locale;
}

export function useSetLocale() {
  const { setLocale, isPending } = useContext(LocaleCtx);
  return { setLocale, isPending };
}

export function useT(): Dict {
  return dictFor(useContext(LocaleCtx).locale);
}
