import * as SecureStore from "expo-secure-store";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nManager } from "react-native";
import { settleOrNull } from "@/api/client";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  appDictFor,
  dictFor,
  pickFromLanguageTags,
  type AppDict,
  type Dict,
  type Locale,
} from "@/shared/i18n";

// The app's locale: the web's es/en dictionaries, resolved the way the web
// resolves them — an explicit choice first, the device's language second,
// English last — minus the cookie and the URL, which a native client has
// neither of.
//
// The explicit choice persists in SecureStore under its own key. Not the
// obvious store for a two-letter preference, but it is the ONE persistence
// layer the app already has (the device id and Clerk's session live there),
// and adding AsyncStorage for one value would be a new dependency. On iOS the
// keychain survives an uninstall, so a reinstalled app remembers the language
// — harmless for a preference.
const LOCALE_KEY = "matio_locale";

// Same deadline as the other keychain pre-flights in api/client.ts: a hung
// SecureStore must degrade to "detect", never hold the splash forever.
const READ_TIMEOUT_MS = 3_000;

// Every dictionary the app renders from: the web's public copy plus the
// app-only strings under `app`.
export type AppT = Dict & { app: AppDict };

function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// The device language → a supported locale, with NO new dependency.
//
// Two sources, in order:
//   1. I18nManager.getConstants().localeIdentifier — the locale React Native
//      exports from the OS setting. Android fills it (`Locale.getDefault()`,
//      e.g. "es_ES"); iOS's RCTI18nManager does NOT export it in RN 0.86
//      (checked in node_modules), so there it is simply absent.
//   2. Intl.DateTimeFormat().resolvedOptions().locale — Hermes' own Intl,
//      which asks the platform for its default locale (NSLocale on iOS).
//      The iOS path in practice.
//
// Both tags run through the web's pickFromLanguageTags (primary subtag,
// case-insensitive, underscore-tolerant), so "es-419" / "es_MX" resolve to
// Spanish exactly as an Accept-Language header would on the site. Anything
// unmatched — or any source that throws — falls to English, the site's
// default. The manual switcher in the home header covers a device this
// misreads; the choice it writes wins on every later launch.
export function detectDeviceLocale(): Locale {
  const tags: string[] = [];
  try {
    const native = I18nManager.getConstants().localeIdentifier;
    if (typeof native === "string") tags.push(native);
  } catch {
    // Constants unavailable (an unusual host) — fall through to Intl.
  }
  try {
    tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // No Intl in this runtime — English.
  }
  return pickFromLanguageTags(tags) ?? DEFAULT_LOCALE;
}

// Resolves the locale to start in: the stored choice if there is one, else
// detection. Null until the keychain has answered — the root layout holds
// the splash on this the same way it holds it on the brand fonts, so the
// first frame never renders in a language the user then sees flip.
export function useInitialLocale(): Locale | null {
  const [locale, setLocale] = useState<Locale | null>(null);

  useEffect(() => {
    let cancelled = false;
    void settleOrNull(SecureStore.getItemAsync(LOCALE_KEY), READ_TIMEOUT_MS).then((stored) => {
      if (cancelled) return;
      setLocale(isLocale(stored) ? stored : detectDeviceLocale());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return locale;
}

type Ctx = {
  locale: Locale;
  setLocale: (next: Locale) => void;
};

const LocaleCtx = createContext<Ctx>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function LocaleProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  // Optimistic, like the web's switcher: every useT() consumer re-renders
  // with the new dictionary immediately; the persistence is fire-and-forget
  // (a failed write costs the user one more tap next launch, nothing else).
  const setLocale = useCallback((next: Locale) => {
    if (!isLocale(next)) return;
    setLocaleState(next);
    SecureStore.setItemAsync(LOCALE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return <LocaleCtx value={value}>{children}</LocaleCtx>;
}

export function useLocale(): Locale {
  return use(LocaleCtx).locale;
}

export function useSetLocale(): (next: Locale) => void {
  return use(LocaleCtx).setLocale;
}

// The dictionary for the current locale. The web's Dict carries functions
// (pluralisation, interpolation), which is why the locale string — not the
// dict — is what lives in context; the dict is derived per consumer.
export function useT(): AppT {
  const { locale } = use(LocaleCtx);
  return useMemo(() => ({ ...dictFor(locale), app: appDictFor(locale) }), [locale]);
}
