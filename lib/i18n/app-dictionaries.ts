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
    // The show page's «‹» to VoiceOver (#288), and the visible way out of an
    // error on a pushed screen (#292).
    back: "Volver",
    cancel: "Cancelar",
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
    // Spoken only (VoiceOver): the search field's «×» (#288).
    clearSearch: "Borrar búsqueda",
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
    // Clerk would not load — a vendor error, no network, an outage (#253).
    stalledTitle: "No se puede iniciar sesión ahora mismo",
    stalledBody: "Revisa tu conexión e inténtalo de nuevo.",
    // The sign-out confirmation and its failure (#292) — getting back in
    // costs an email round trip, so one stray tap must not end the session.
    signOutConfirmTitle: "¿Cerrar sesión?",
    signOutConfirmBody: "Para volver a entrar te enviaremos un código a tu correo.",
    signOutFailed: "No se pudo cerrar la sesión",
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
    // Opens TestFlight (#292) — the app is not in the App Store yet.
    cta: "Actualizar",
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
    // Clerk's answers, which it only gives in English (#288): the form maps
    // their codes here and never shows Clerk's own text.
    codeIncorrect: "El código no es correcto.",
    codeExpired: "El código ha caducado. Pide uno nuevo.",
    codeFailed: "Demasiados intentos fallidos. Pide un código nuevo.",
    tooManyRequests: "Demasiados intentos. Inténtalo de nuevo en un momento.",
    // The code step's resend link and its cooldown (#292).
    resend: "Reenviar código",
    resendIn: (seconds: number) => `Reenviar código en ${seconds} s`,
    // The form after «¿Ya tienes cuenta? Inicia sesión» (#292): the same
    // email → code flow, worded for a returning member, and the way back.
    signInHeadline: "Inicia sesión",
    signInBody: "Te enviaremos un código a tu correo. Sin contraseña.",
    noAccount: "¿No tienes cuenta?",
    createAccount: "Crear cuenta",
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
    back: "Back",
    cancel: "Cancel",
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
    clearSearch: "Clear search",
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
    stalledTitle: "Sign-in is unavailable right now",
    stalledBody: "Check your connection and try again.",
    signOutConfirmTitle: "Sign out?",
    signOutConfirmBody: "To sign back in, we'll email you a code.",
    signOutFailed: "Couldn't sign out",
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
    cta: "Update",
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
    codeIncorrect: "Incorrect code.",
    codeExpired: "This code has expired. Request a new one.",
    codeFailed: "Too many failed attempts. Request a new code.",
    tooManyRequests: "Too many requests. Please try again in a moment.",
    resend: "Resend code",
    resendIn: (seconds: number) => `Resend code in ${seconds}s`,
    signInHeadline: "Sign in",
    signInBody: "We'll email you a code. No password needed.",
    noAccount: "No account yet?",
    createAccount: "Create account",
  },
  watch: {
    subscribersOnly: "Subscribers only",
    subscribersOnlyHint: "This episode needs an active subscription.",
  },
};

export function appDictFor(locale: Locale): AppDict {
  return locale === "en" ? appEn : appEs;
}
