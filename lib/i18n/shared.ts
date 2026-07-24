// Shared constants safe for both server and client bundles. The
// locale cookie name lives here so the client-side optimistic flip in
// LocaleProvider can mirror the value via document.cookie without
// pulling in the server-only module (lib/i18n/server.ts is "server-only").
export const LOCALE_COOKIE_NAME = "locale";

// One year. The switcher, the setLocale server action, and the /es rewrite in
// proxy.ts all write the locale cookie with this lifetime.
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Request header the /es rewrite stamps so getLocale() (lib/i18n/server.ts)
// resolves Spanish from the URL — authoritative over the sticky cookie, so an
// /es/* page always renders Spanish regardless of a returning user's cookie.
export const URL_LOCALE_HEADER = "x-matio-locale";
