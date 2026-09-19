// Copy that exists ONLY in the mobile app — sign-in steps the web delegates
// to Clerk's modal, the forced-update screen, the app's own load/reachability
// errors, the native shell's tab titles / Browse / Account / Settings (#245)
// and the Home feed's two strings (#248). Everything the web already says (rails, walls, player labels,
// durations, legal links, the sign-up wall) the app reads straight from
// dictionaries.ts; nothing is copied.
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
  tabs: {
    home: "Inicio",
    browse: "Explorar",
    account: "Cuenta",
    settings: "Ajustes",
  },
  browse: {
    all: "Todo",
    vertical: "Vertical",
    noResults: "Ninguna serie coincide.",
  },
  // The Home feed under the carousel (#248): the signed-in «Up next» block and
  // its resume pill. Everything else the feed prints — Just released, Popular
  // now, New, Ep. n, Play, minutes, the episode count, the tagline — is the
  // web's copy, read straight from dictionaries.ts.
  home: {
    upNext: "A continuación",
    resume: "Continuar",
  },
  account: {
    member: "Miembro",
    signOut: "Cerrar sesión",
    whyKicker: "Tu progreso, en todos tus dispositivos",
    whyBody: "Sigue viendo donde lo dejaste, también en matio.tv.",
  },
  settings: {
    langHint: "Sigue el idioma del dispositivo hasta que elijas.",
    playback: "Reproducción",
    autoplayNext: "Reproducir el siguiente episodio",
    autoplayHint: "Solo en series horizontales; el feed vertical siempre continúa.",
    version: "Versión",
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
  tabs: {
    home: "Home",
    browse: "Browse",
    account: "Account",
    settings: "Settings",
  },
  browse: {
    all: "All",
    vertical: "Vertical",
    noResults: "No shows match.",
  },
  home: {
    upNext: "Up next",
    resume: "Resume",
  },
  account: {
    member: "Member",
    signOut: "Sign out",
    whyKicker: "Your progress, on every device",
    whyBody: "Pick up where you left off — on matio.tv too.",
  },
  settings: {
    langHint: "Follows your device language until you choose.",
    playback: "Playback",
    autoplayNext: "Play next episode automatically",
    autoplayHint: "Applies to horizontal shows; vertical feeds always continue.",
    version: "Version",
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
