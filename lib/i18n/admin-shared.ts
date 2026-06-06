// Shared constants safe for both server and client bundles — the admin
// counterpart of lib/i18n/shared.ts. The admin locale cookie name lives
// here so the client-side optimistic flip in AdminLocaleProvider can
// mirror the value via document.cookie without pulling in the
// server-only module (lib/i18n/admin-server.ts is "server-only").
export const ADMIN_LOCALE_COOKIE_NAME = "admin_locale";
