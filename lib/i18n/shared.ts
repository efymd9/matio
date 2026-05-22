// Shared constants safe for both server and client bundles. The
// locale cookie name lives here so the client-side optimistic flip in
// LocaleProvider can mirror the value via document.cookie without
// pulling in the server-only module (lib/i18n/server.ts is "server-only").
export const LOCALE_COOKIE_NAME = "locale";
