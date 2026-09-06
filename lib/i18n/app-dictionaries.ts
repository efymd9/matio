// Copy that exists ONLY in the mobile app — sign-in steps the web delegates
// to Clerk's modal, the forced-update screen, the app's own load/reachability
// errors. Everything the web already says (rails, walls, player labels,
// durations) the app reads straight from dictionaries.ts; nothing is copied.
//
// A separate file rather than an `app` section in dictionaries.ts for the
// same reason admin-dictionaries.ts is separate: dictionaries.ts ships in the
// web's client bundle, and these strings never render there. Universal — no
// imports beyond the Locale type — so Metro can bundle it (mobile/src/shared/
// i18n.ts re-exports it).

import type { Locale } from "./dictionaries";

export const appEs = {
  common: {
    loadFailed: "No pudimos cargar Matio",
    unreachable: "No conseguimos conectar con Matio",
    showLoadFailed: "No pudimos cargar esta serie",
    notNow: "Ahora no",
    pleaseWait: "Un momento…",
  },
  home: {
    allShows: "Todas las series",
  },
  update: {
    title: "Actualiza Matio",
    body: "Esta versión ya no puede reproducir. Actualiza la app para seguir viendo.",
    cta: "Abrir matio.tv",
  },
  signIn: {
    checkEmail: "Revisa tu correo",
    codeSent: (email: string) => `Hemos enviado un código a ${email}.`,
    invalidEmail: "Introduce un correo válido.",
    invalidCode: "Introduce el código de tu correo.",
    sendCode: "Enviar código",
    verify: "Entrar",
    differentEmail: "Usar otro correo",
    unavailable: "Inicio de sesión no disponible",
    unavailableHint: "Esta versión no tiene configurada la clave de Clerk.",
  },
  watch: {
    subscribersOnly: "Solo para suscriptores",
    subscribersOnlyHint: "Este episodio requiere una suscripción activa.",
  },
};

export type AppDict = typeof appEs;

export const appEn: AppDict = {
  common: {
    loadFailed: "Couldn't load Matio",
    unreachable: "Couldn't reach Matio",
    showLoadFailed: "Couldn't load this show",
    notNow: "Not now",
    pleaseWait: "Please wait…",
  },
  home: {
    allShows: "All shows",
  },
  update: {
    title: "Update Matio",
    body: "This version is out of date and can no longer play. Please update to keep watching.",
    cta: "Open matio.tv",
  },
  signIn: {
    checkEmail: "Check your email",
    codeSent: (email: string) => `We sent a code to ${email}.`,
    invalidEmail: "Enter a valid email address.",
    invalidCode: "Enter the code from your email.",
    sendCode: "Send code",
    verify: "Sign in",
    differentEmail: "Use a different email",
    unavailable: "Sign-in unavailable",
    unavailableHint: "This build has no Clerk publishable key configured.",
  },
  watch: {
    subscribersOnly: "Subscribers only",
    subscribersOnlyHint: "This episode needs an active subscription.",
  },
};

export function appDictFor(locale: Locale): AppDict {
  return locale === "en" ? appEn : appEs;
}
