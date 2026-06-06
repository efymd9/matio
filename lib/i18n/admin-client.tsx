"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  ADMIN_SUPPORTED_LOCALES,
  DEFAULT_ADMIN_LOCALE,
  adminDictFor,
  type AdminDict,
  type AdminLocale,
} from "./admin-dictionaries";
import { setAdminLocale as setAdminLocaleAction } from "./admin-actions";
import { ADMIN_LOCALE_COOKIE_NAME } from "./admin-shared";

// Admin counterpart of lib/i18n/client.tsx — same shape, separate context.
// We thread the locale string + a setter through React context; each
// component resolves the dictionary itself via adminDictFor(locale), so
// the dict (which contains functions for pluralisation / interpolation)
// never has to cross the server→client serialisation boundary.
type Ctx = {
  locale: AdminLocale;
  setLocale: (next: AdminLocale) => void;
  isPending: boolean;
};

const AdminLocaleCtx = createContext<Ctx>({
  locale: DEFAULT_ADMIN_LOCALE,
  setLocale: () => {},
  isPending: false,
});

export function AdminLocaleProvider({
  locale: initialLocale,
  children,
}: {
  locale: AdminLocale;
  children: ReactNode;
}) {
  const router = useRouter();
  // State, not just context value, so the language switcher can flip the
  // locale optimistically. Every consumer of useAdminLocale / useAdminT
  // re-renders instantly with the new dictionary; the server cookie +
  // revalidate happens in the background.
  const [locale, setLocaleState] = useState<AdminLocale>(initialLocale);
  const [isPending, setIsPending] = useState(false);

  // Reconcile if the server later re-renders the tree with a different
  // locale — adjust state during render rather than in an effect (the
  // React 19 idiom; see LocaleProvider in lib/i18n/client.tsx).
  const [lastInitialLocale, setLastInitialLocale] =
    useState<AdminLocale>(initialLocale);
  if (lastInitialLocale !== initialLocale) {
    setLastInitialLocale(initialLocale);
    setLocaleState(initialLocale);
  }

  const setLocale = useCallback(
    (next: AdminLocale) => {
      if (next === locale) return;
      if (!(ADMIN_SUPPORTED_LOCALES as readonly string[]).includes(next))
        return;
      setLocaleState(next);
      setIsPending(true);
      // Mirror to the client-readable cookie immediately so even if the
      // server action's Set-Cookie response somehow loses, the next
      // server render reads the new value (httpOnly:false by design —
      // see lib/i18n/admin-actions.ts).
      document.cookie = `${ADMIN_LOCALE_COOKIE_NAME}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      // Reconcile with the server: action writes the canonical cookie +
      // revalidates the admin layout, then router.refresh pulls fresh
      // server-rendered chunks.
      setAdminLocaleAction(next)
        .then(() => router.refresh())
        .finally(() => setIsPending(false));
    },
    [locale, router],
  );

  return (
    <AdminLocaleCtx.Provider value={{ locale, setLocale, isPending }}>
      {children}
    </AdminLocaleCtx.Provider>
  );
}

export function useAdminLocale(): AdminLocale {
  return useContext(AdminLocaleCtx).locale;
}

export function useAdminSetLocale() {
  const { setLocale, isPending } = useContext(AdminLocaleCtx);
  return { setLocale, isPending };
}

export function useAdminT(): AdminDict {
  return adminDictFor(useContext(AdminLocaleCtx).locale);
}
