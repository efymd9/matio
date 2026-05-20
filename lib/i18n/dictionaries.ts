// String dictionaries for the public surface (catalog, watch, subscribe,
// errors). Admin pages are intentionally not translated and continue to
// render hard-coded English.
//
// Spanish (es-ES) is the default. English is the secondary locale.
// Both dicts import here, so they can be referenced from server and
// client components alike without crossing the React Server Component
// boundary — the LocaleProvider only passes the locale string, the
// dict itself is bundled.

export type Locale = "es" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["es", "en"];
export const DEFAULT_LOCALE: Locale = "es";

export const es = {
  htmlLang: "es-ES",
  language: {
    label: "Idioma",
    es: "Español",
    en: "English",
    switchAria: "Cambiar idioma",
  },
  header: {
    home: "matio · inicio",
    browse: "Explorar",
    subscribe: "Suscribirse",
    search: "Buscar",
    signIn: "Iniciar sesión",
    signUp: "Crear cuenta",
  },
  userMenu: {
    manageSubscription: "Gestionar suscripción",
  },
  home: {
    comingSoonKicker: "Próximamente",
    storiesHeadline: "Historias que merecen tu tiempo.",
    catalogBeingCurated: "Estamos preparando el catálogo. Vuelve en un momento.",
    justReleased: "Recién estrenado",
    popularNow: "Popular ahora",
  },
  hero: {
    matioOriginal: "Original Matio",
    play: "Reproducir",
    moreInfo: "Más información",
  },
  genreRow: {
    seeAll: "Ver todo →",
  },
  showDetail: {
    notFound: "No encontrado",
    matchLabel: "% de coincidencia",
    matchValue: "● 96 % de coincidencia",
    ageRating: "16+",
    quality: "HD",
    episode: "episodio",
    episodes: "episodios",
    play: "Reproducir",
    downloadEp1: "Descargar episodio 1",
    genreLabel: "Género: ",
    tabEpisodes: "Episodios",
    tabRelated: "Relacionado",
    tabAbout: "Información",
    noEpisodesYetHeader: "Aún no hay episodios",
    noEpisodesYetLine: "Aún no hay episodios.",
    season: (n: number) => `Temporada ${n}`,
    minutes: (m: number) => `${m} min`,
    soon: "Pronto",
    episodeCount: (n: number) =>
      n === 1 ? `${n} episodio` : `${n} episodios`,
  },
  watch: {
    comingSoonTitle: "Próximamente",
    noEpisodesReady: "Aún no hay episodios disponibles.",
    backToShowAria: "Volver a la serie",
    loading: "Cargando",
  },
  watchError: {
    kicker: "Reproducción interrumpida",
    title: "La cinta se atascó.",
    body: "Algo falló al obtener este episodio. Inténtalo de nuevo o elige otra serie.",
    refLabel: "ref",
    tryAgain: "Intentar de nuevo",
    backToCatalog: "Volver al catálogo",
  },
  player: {
    backToShowAria: "Volver a la serie",
    castAria: "Transmitir",
    captionsAria: "Activar/desactivar subtítulos",
    back10Aria: "Retroceder 10 segundos",
    forward10Aria: "Avanzar 10 segundos",
    playPauseAria: "Reproducir / Pausar",
    skipIntro: "Saltar intro",
    muteAria: "Silenciar / activar sonido",
    lockAria: "Bloquear controles",
    unlockAria: "Desbloquear controles",
    tapToUnlock: "Toca para desbloquear",
    rateAria: "Velocidad de reproducción",
    episodesBtn: "Episodios",
    upNextBtn: "A continuación",
    qualityAria: "Calidad de vídeo",
    fullscreenAria: "Pantalla completa",
  },
  episodesOverlay: {
    title: "Episodios",
    closeAria: "Cerrar",
    season: (n: number) => `Temporada ${n}`,
    nowPlaying: "En reproducción",
    minutes: (m: number) => `${m} min`,
    count: (n: number) =>
      n === 1 ? `${n} episodio` : `${n} episodios`,
  },
  upNextOverlay: {
    label: "A continuación",
    watchNow: "Ver ahora",
    cancel: "Cancelar",
    playingIn: (s: number) => `Empieza en ${s} s`,
  },
  paywall: {
    previewComplete: "Vista previa terminada",
    continueWatching: "Continúa viendo",
    yourStory: "Tu historia",
    pickUpWhereLeftOff: "Retoma justo donde lo dejaste.",
    choosePlanAria: "Elige un plan de suscripción",
    monthly: "Mensual",
    annual: "Anual",
    cancelAnytime: "cancela cuando quieras",
    perMonthApprox: "≈ 6,67 $/mes",
    continuingToCheckout: "Yendo al pago…",
    continueSubscribe: "Continuar · Suscribirse",
    cancelAnytimeFromAccount: "Cancela cuando quieras desde tu cuenta.",
  },
  subscribe: {
    membershipKicker: "Membresía",
    pickAPlan: "Elige un plan.",
    watchEverything: "Disfruta de todo.",
    cancelAnytimeAll: "Cancela cuando quieras. Todos los originales incluidos.",
    choosePlanAria: "Elige un plan de suscripción",
    monthly: "Mensual",
    monthlyPrice: "9,99 $",
    monthlyInterval: "mes",
    monthlySub: "Facturación mensual · cancela cuando quieras",
    annual: "Anual",
    annualPrice: "79,99 $",
    annualInterval: "año",
    annualSub: "≈ 6,67 $/mes · 33 % de descuento",
    bestValueBadge: "Mejor valor",
    selected: "Seleccionado",
    chooseThisPlan: "Elegir este plan",
    secureCheckout: "Pago seguro con Stripe",
    cancelInOneClick: "Cancela con un clic",
    fourKWhenAvailable: "4K cuando está disponible",
    redirectingToCheckout: "Redirigiendo al pago…",
    continueSubscribe: "Continuar · Suscribirse",
    alreadyMemberKicker: "Ya eres miembro",
    youreSubscribed: "Estás suscrito.",
    yourPlanIs: (plan: string, status: string) =>
      `Tu plan ${plan} está ${status}. Cambia o cancela cuando quieras en tu cuenta.`,
    manageSubscription: "Gestionar suscripción",
    backToBrowse: "Volver a explorar",
  },
  notFound: {
    code: "404",
    title: "No está en el catálogo.",
    body: "Esta página se movió, dejó de publicarse o nunca existió. Vuelve al catálogo y continúa donde lo dejaste.",
    backHome: "Volver al inicio",
  },
  appError: {
    kicker: "Algo falló",
    title: "Cogeremos la siguiente toma.",
    body: "Algo se torció por nuestro lado. Ya está registrado. Inténtalo de nuevo o vuelve al catálogo.",
    refLabel: "ref",
    tryAgain: "Intentar de nuevo",
    backHome: "Volver al inicio",
  },
  globalError: {
    kicker: "Algo falló",
    title: "Cogeremos la siguiente toma.",
    body: "El diseño base no pudo cargarse. Actualiza la página o inténtalo dentro de un momento.",
    refLabel: "ref",
    tryAgain: "Intentar de nuevo",
  },
  metadata: {
    siteTitle: "matio — historias originales en streaming",
    siteTitleTemplate: "%s · matio",
    siteDescription:
      "El hogar en streaming por suscripción para historias originales en formato corto. Mira los primeros 60 segundos gratis.",
    twitterTitle: "matio",
    twitterDescription:
      "Historias originales en streaming. Mira los primeros 60 segundos gratis.",
  },
  og: {
    kicker: "Streaming de originales",
    title: ["Historias originales,", "en streaming."],
    tagline: "Mira los primeros 60 segundos gratis.",
  },
};

// `Dict` is structurally defined by the Spanish dictionary so the English
// one is type-checked against the same shape. Functions stay typed
// (parameter + return type are inferred via `typeof es`).
export type Dict = typeof es;

export const en: Dict = {
  htmlLang: "en",
  language: {
    label: "Language",
    es: "Español",
    en: "English",
    switchAria: "Switch language",
  },
  header: {
    home: "matio home",
    browse: "Browse",
    subscribe: "Subscribe",
    search: "Search",
    signIn: "Sign in",
    signUp: "Sign up",
  },
  userMenu: {
    manageSubscription: "Manage subscription",
  },
  home: {
    comingSoonKicker: "Coming soon",
    storiesHeadline: "Stories worth your time.",
    catalogBeingCurated: "The catalog is being curated. Check back shortly.",
    justReleased: "Just released",
    popularNow: "Popular now",
  },
  hero: {
    matioOriginal: "Matio Original",
    play: "Play",
    moreInfo: "More info",
  },
  genreRow: {
    seeAll: "See all →",
  },
  showDetail: {
    notFound: "Not found",
    matchLabel: "% match",
    matchValue: "● 96% match",
    ageRating: "16+",
    quality: "HD",
    episode: "episode",
    episodes: "episodes",
    play: "Play",
    downloadEp1: "Download episode 1",
    genreLabel: "Genre: ",
    tabEpisodes: "Episodes",
    tabRelated: "Related",
    tabAbout: "About",
    noEpisodesYetHeader: "No episodes yet",
    noEpisodesYetLine: "No episodes yet.",
    season: (n: number) => `Season ${n}`,
    minutes: (m: number) => `${m} min`,
    soon: "Soon",
    episodeCount: (n: number) =>
      n === 1 ? `${n} episode` : `${n} episodes`,
  },
  watch: {
    comingSoonTitle: "Coming soon",
    noEpisodesReady: "No episodes ready yet.",
    backToShowAria: "Back to show",
    loading: "Loading",
  },
  watchError: {
    kicker: "Playback interrupted",
    title: "The reel jammed.",
    body: "Something went wrong fetching this episode. Try again, or pick a different show.",
    refLabel: "ref",
    tryAgain: "Try again",
    backToCatalog: "Back to catalog",
  },
  player: {
    backToShowAria: "Back to show",
    castAria: "Cast",
    captionsAria: "Toggle captions",
    back10Aria: "Back 10 seconds",
    forward10Aria: "Forward 10 seconds",
    playPauseAria: "Play/Pause",
    skipIntro: "Skip intro",
    muteAria: "Mute / unmute",
    lockAria: "Lock controls",
    unlockAria: "Unlock controls",
    tapToUnlock: "Tap to unlock",
    rateAria: "Playback speed",
    episodesBtn: "Episodes",
    upNextBtn: "Up Next",
    qualityAria: "Video quality",
    fullscreenAria: "Toggle fullscreen",
  },
  episodesOverlay: {
    title: "Episodes",
    closeAria: "Close",
    season: (n: number) => `Season ${n}`,
    nowPlaying: "Now playing",
    minutes: (m: number) => `${m} min`,
    count: (n: number) =>
      n === 1 ? `${n} episode` : `${n} episodes`,
  },
  upNextOverlay: {
    label: "Up next",
    watchNow: "Watch now",
    cancel: "Cancel",
    playingIn: (s: number) => `Playing in ${s}s`,
  },
  paywall: {
    previewComplete: "Preview complete",
    continueWatching: "Continue watching",
    yourStory: "Your story",
    pickUpWhereLeftOff: "Pick up where you left off.",
    choosePlanAria: "Choose a subscription plan",
    monthly: "Monthly",
    annual: "Annual",
    cancelAnytime: "cancel anytime",
    perMonthApprox: "≈ $6.67/mo",
    continuingToCheckout: "Continuing to checkout…",
    continueSubscribe: "Continue · Subscribe",
    cancelAnytimeFromAccount: "Cancel anytime from your account.",
  },
  subscribe: {
    membershipKicker: "Membership",
    pickAPlan: "Pick a plan.",
    watchEverything: "Watch everything.",
    cancelAnytimeAll: "Cancel anytime. All originals included.",
    choosePlanAria: "Choose a subscription plan",
    monthly: "Monthly",
    monthlyPrice: "$9.99",
    monthlyInterval: "month",
    monthlySub: "Billed monthly · cancel anytime",
    annual: "Annual",
    annualPrice: "$79.99",
    annualInterval: "year",
    annualSub: "≈ $6.67/mo · 33% off",
    bestValueBadge: "Best value",
    selected: "Selected",
    chooseThisPlan: "Choose this plan",
    secureCheckout: "Secure checkout via Stripe",
    cancelInOneClick: "Cancel in one click",
    fourKWhenAvailable: "4K when available",
    redirectingToCheckout: "Redirecting to checkout…",
    continueSubscribe: "Continue · Subscribe",
    alreadyMemberKicker: "Already a member",
    youreSubscribed: "You're subscribed.",
    yourPlanIs: (plan: string, status: string) =>
      `Your ${plan} plan is ${status}. Change or cancel any time in your account.`,
    manageSubscription: "Manage subscription",
    backToBrowse: "Back to browse",
  },
  notFound: {
    code: "404",
    title: "Not in the catalog.",
    body: "This page either moved, was unpublished, or never existed. Head back to the catalog and pick up where you left off.",
    backHome: "Back to home",
  },
  appError: {
    kicker: "Something glitched",
    title: "We'll catch the next take.",
    body: "Something went sideways on our end. We've logged it. Try again, or head back to the catalog.",
    refLabel: "ref",
    tryAgain: "Try again",
    backHome: "Back to home",
  },
  globalError: {
    kicker: "Something glitched",
    title: "We'll catch the next take.",
    body: "The root layout failed to render. Refresh, or try again in a moment.",
    refLabel: "ref",
    tryAgain: "Try again",
  },
  metadata: {
    siteTitle: "matio — original stories, streamed",
    siteTitleTemplate: "%s · matio",
    siteDescription:
      "A subscription streaming home for original short-form stories. Watch the first 60 seconds free.",
    twitterTitle: "matio",
    twitterDescription:
      "Original stories, streamed. Watch the first 60 seconds free.",
  },
  og: {
    kicker: "Streaming originals",
    title: ["Original stories,", "streamed."],
    tagline: "Watch the first 60 seconds free.",
  },
};

export const DICTS = { es, en } as const;

export function dictFor(locale: Locale): Dict {
  return locale === "en" ? en : es;
}
