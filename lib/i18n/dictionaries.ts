// String dictionaries for the public surface (catalog, watch, subscribe,
// errors). Admin pages are NOT covered here — the admin panel has its own
// separate ru/en system in admin-dictionaries.ts (Russian default, own
// admin_locale cookie) that never affects the visitor-facing language.
//
// English is the default (since 2026-07-04 — was Spanish). Spanish is
// served ONLY on explicit signals: an es Accept-Language, the switcher
// cookie, or an /es URL. The geo tiebreak (Hispanophone-country guess for
// unmatched headers) was removed 2026-08-31 — see negotiate.ts for why.
// Both dicts import here, so they can be referenced from server and
// client components alike without crossing the React Server Component
// boundary — the LocaleProvider only passes the locale string, the
// dict itself is bundled.

export type Locale = "es" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["es", "en"];
export const DEFAULT_LOCALE: Locale = "en";

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
    menuAria: "Abrir menú",
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
    continueWatching: "Continúa viendo",
    top3: "Top 3 en España",
    newBadge: "Nuevo",
    epShort: (n: number) => `Ep. ${n}`,
  },
  hero: {
    matioOriginal: "Original Matio",
    play: "Reproducir",
    moreInfo: "Más información",
    watchFree: "Ver gratis",
    premiereBadge: "Original · Estreno",
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
    breadcrumbHome: "Inicio",
    shareAria: "Compartir",
    watchOnlineTitle: (title: string) => `${title} — Ver online`,
    synopsisFallback: (title: string, genre: string[]) =>
      `${title}: serie original de Matio${
        genre.length ? ` · ${genre.join(", ")}` : ""
      }. Míralo en streaming por suscripción.`,
    // Payments-off variant (lib/free-mode.ts): no subscription to sell.
    synopsisFallbackFree: (title: string, genre: string[]) =>
      `${title}: serie original de Matio${
        genre.length ? ` · ${genre.join(", ")}` : ""
      }. Míralo gratis en streaming.`,
    castTitle: "Actores virtuales",
    castAs: (c: string) => `como ${c}`,
    castViewProfile: "Ver perfil →",
  },
  actorPage: {
    notFound: "No encontrado",
    virtualActor: "Actor virtual",
    appearsIn: "Aparece en",
    noShowsYet: "Todavía no aparece en ninguna serie.",
    metaTitle: (name: string) => `${name} — Actor virtual`,
    metaDescription: (name: string) =>
      `${name}: actor virtual de Matio. Biografía y series en las que aparece.`,
  },
  watch: {
    comingSoonTitle: "Próximamente",
    noEpisodesReady: "Aún no hay episodios disponibles.",
    backToShowAria: "Volver a la serie",
    loading: "Cargando",
    rateLimitedKicker: "Has visto varias vistas previas",
    rateLimitedTitle: "Espera un momento antes de continuar.",
    rateLimitedBody:
      "Para evitar que las vistas previas se conviertan en visionado completo, las limitamos durante una hora. Suscríbete para seguir sin pausas.",
    rateLimitedSubscribe: "Suscribirse",
    rateLimitedBack: "Volver al catálogo",
    unavailableKicker: "Reproducción no disponible",
    unavailableTitle: "No conseguimos cargar este episodio.",
    unavailableBody:
      "Probablemente sea cosa nuestra. Inténtalo de nuevo en un momento.",
    unavailableRetry: "Reintentar",
    unavailableBack: "Volver a la serie",
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
    prevAria: "Episodio anterior",
    nextAria: "Siguiente episodio",
    shareAria: "Compartir",
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
    playPreview: "Ver 60 s gratis",
    playFreeEpisode: "Ver gratis",
    fullscreenAria: "Pantalla completa",
    tapForSound: "Activar sonido",
  },
  episodesOverlay: {
    title: "Episodios",
    closeAria: "Cerrar",
    season: (n: number) => `Temporada ${n}`,
    nowPlaying: "En reproducción",
    minutes: (m: number) => `${m} min`,
    count: (n: number) =>
      n === 1 ? `${n} episodio` : `${n} episodios`,
    lockedSignup: "Crea una cuenta",
    lockedSubscribe: "Suscríbete",
    lockedAria: "Episodio bloqueado",
  },
  upNextOverlay: {
    label: "A continuación",
    watchNow: "Ver ahora",
    cancel: "Cancelar",
    playingIn: (s: number) => `Empieza en ${s} s`,
  },
  seriesEndOverlay: {
    label: "Aviso para el próximo episodio",
    kicker: "Eso es todo · por ahora",
    headline: (showTitle: string) =>
      `Gracias por ver ${showTitle}.`,
    body: "El próximo episodio está en producción y se estrenará pronto. Déjanos tu email y te avisamos cuando esté listo.",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "tu@email.com",
    submitCta: "Avísame",
    submitting: "Guardando…",
    successBody: "Te avisaremos en cuanto se estrene. Prometido.",
    closeCta: "Cerrar",
    dismissAria: "Cerrar aviso",
    privacyNote: "Solo lo usaremos para avisar del próximo episodio.",
    errorInvalidEmail: "Ese correo no parece válido. Inténtalo de nuevo.",
    errorRateLimited:
      "Demasiados intentos desde tu red. Inténtalo de nuevo en un rato.",
    errorGeneric: "Algo salió mal. Inténtalo de nuevo.",
  },
  unsubscribe: {
    metaTitle: "Darse de baja",
    heading: "Darse de baja",
    confirmBody: (email: string) =>
      `¿Quieres dejar de recibir avisos de nuevos episodios en ${email}?`,
    confirmCta: "Sí, darme de baja",
    doneHeading: "Listo",
    doneBody:
      "Hemos eliminado tu correo. No volveremos a enviarte avisos de episodios.",
    invalidHeading: "Enlace no válido",
    invalidBody:
      "Este enlace de baja no es válido. Escríbenos a contact@matio.tv y nos encargamos.",
    backHome: "Volver al inicio",
  },
  paywall: {
    previewComplete: "Vista previa terminada",
    continueWatching: "Continúa viendo",
    yourStory: "Tu historia",
    pickUpWhereLeftOff: "Retoma justo donde lo dejaste.",
    signUpToContinue: "Crea una cuenta gratis para seguir viendo.",
    signUpCta: "Crear cuenta",
    payFirstBody:
      "Mira 3 días por 1 $, luego 38 $/mes. Creamos tu cuenta con el correo del pago y cancelas cuando quieras.",
    payFirstCta: "Pruébalo · 1 $ por 3 días",
    alreadyMember: "¿Ya tienes cuenta?",
    signInLink: "Inicia sesión",
    continuingToCheckout: "Yendo al pago…",
    continueSubscribe: "Continuar · Suscribirse",
    cancelAnytimeFromAccount: "Cancela cuando quieras desde tu cuenta.",
    allFreeWatched: "Episodios gratis completados",
    subscribeBody:
      "Suscríbete para ver todo el catálogo y los próximos episodios.",
    benefits:
      "Todos los episodios · Catálogo completo · Cancela cuando quieras",
    openInBrowserHeading: "Ábrelo en tu navegador",
    openInBrowserIos:
      "Para pagar y entrar a tu cuenta sin problemas, toca ••• arriba y elige «Abrir en Safari» — o copia el enlace y pégalo en tu navegador.",
    openInBrowserAndroid:
      "Para pagar y entrar a tu cuenta sin problemas, ábrelo en Chrome.",
    openInBrowserAndroidCta: "Abrir en Chrome",
    openInBrowserCopy: "Copiar enlace",
    openInBrowserCopied: "Enlace copiado",
    openInBrowserDismiss: "Cerrar",
  },
  signupWall: {
    kicker: "Continúa gratis",
    freeComplete: "Episodios gratis vistos",
    headline: "Crea tu cuenta",
    headlineFallback: "Tu historia",
    body: (n: number) =>
      n === 1
        ? `Crea una cuenta gratis y desbloquea ${n} episodio más al instante.`
        : `Crea una cuenta gratis y desbloquea ${n} episodios más al instante.`,
    bodyNoCount:
      "Crea una cuenta gratis para seguir viendo y guardar tu progreso en todas las series.",
    // Signup-gate variant (REQUIRE_SIGNUP): greets a viewer who hasn't
    // watched anything yet — no "continúa"/"más episodios" framing.
    gateKicker: "Mira gratis",
    gateBody:
      "Crea una cuenta gratis para empezar a ver y guardar tu progreso en todas las series.",
    signUpCta: "Crear cuenta gratis",
    alreadyMember: "¿Ya tienes cuenta?",
    signInLink: "Inicia sesión",
    noCardNeeded: "Sin tarjeta. Solo un email.",
  },
  subscribe: {
    membershipKicker: "Membresía",
    membershipHeadline: "Hazte miembro.",
    watchEverything: "Disfruta de todo.",
    cancelAnytimeAll: "Cancela cuando quieras. Todos los originales incluidos.",
    monthly: "Membresía",
    monthlyPrice: "1 $",
    monthlyInterval: "3 días",
    monthlySub: "Luego 38 $/mes · cancela cuando quieras",
    secureCheckout: "Pago seguro con Stripe",
    cancelInOneClick: "Cancela con un clic",
    fourKWhenAvailable: "4K cuando está disponible",
    redirectingToCheckout: "Redirigiendo al pago…",
    continueSubscribe: "Continuar · Suscribirse",
    withdrawalWaiver:
      "Solicito que matio comience la reproducción de inmediato y reconozco que pierdo mi derecho de desistimiento de 14 días una vez que comience la reproducción.",
    alreadyMemberKicker: "Ya eres miembro",
    youreSubscribed: "Estás suscrito.",
    yourPlanIs: (plan: string, status: string) =>
      `Tu plan ${plan} está ${status}. Cambia o cancela cuando quieras en tu cuenta.`,
    manageSubscription: "Gestionar suscripción",
    backToBrowse: "Volver a explorar",
  },
  checkout: {
    kicker: "Pago seguro",
    title: "Completa tu membresía.",
    back: "Volver",
    loading: "Cargando el pago seguro…",
    errorBody: "No pudimos cargar el pago. Inténtalo de nuevo.",
    retry: "Reintentar",
  },
  welcome: {
    kicker: "Membresía activa",
    title: "Bienvenido a matio.",
    signingIn: "Iniciando tu sesión…",
    ready: "Todo listo.",
    watchNow: "Ver ahora",
    accountEmail: (maskedEmail: string) =>
      `Tu membresía está vinculada a ${maskedEmail}.`,
    signInToWatch:
      "Inicia sesión con ese correo para empezar a ver — te enviaremos un código.",
    ticketFailed:
      "No pudimos iniciar tu sesión automáticamente. Inicia sesión con el correo que usaste en el pago.",
    claimPending:
      "El pago se ha procesado y tu cuenta se está activando. Inicia sesión con el correo que usaste en el pago, o vuelve a abrir este enlace en un momento.",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "tu@correo.com",
    sendCodeCta: "Enviar código",
    sendingCode: "Enviando…",
    codeSentTo: (email: string) =>
      `Te enviamos un código a ${email}. Revisa también la carpeta de spam.`,
    codeLabel: "Código de verificación",
    codePlaceholder: "Código de 6 dígitos",
    verifyCta: "Verificar y entrar",
    verifying: "Verificando…",
    resendCta: "Reenviar código",
    changeEmail: "Cambiar correo",
    codeSendFailed:
      "No pudimos enviar el código. Comprueba el correo o abre esta página en tu navegador.",
    codeWrong: "Código incorrecto o caducado. Inténtalo de nuevo.",
    wrongEmail: "¿No es tu correo? Escríbenos a contact@matio.tv",
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
    // Payments-off variants (lib/free-mode.ts): the indexed copy must not
    // promise a subscription gate or a 60s preview that no longer exists.
    siteDescriptionFree:
      "El hogar en streaming de historias originales en formato corto. Todo el catálogo, gratis.",
    twitterTitle: "matio",
    twitterDescription:
      "Historias originales en streaming. Mira los primeros 60 segundos gratis.",
    twitterDescriptionFree:
      "Historias originales en streaming. Todo el catálogo, gratis.",
  },
  og: {
    kicker: "Streaming de originales",
    title: ["Historias originales,", "en streaming."],
    tagline: "Mira los primeros 60 segundos gratis.",
    taglineFree: "Míralo todo gratis.",
  },
  about: {
    metaTitle: "Acerca de Matio",
    metaDescription:
      "Matio es un estudio independiente: historias románticas oscuras y series cortas creadas con más de 12 herramientas de IA, del guion al fotograma final.",
    heroBadge: "Acerca de matio",
    heroTitle1: "Mundos de historias.",
    heroTitle2: "Un estudio.",
    // La variante «free» añade la frase de gratuidad; con pagos activados se
    // muestra la neutra (la página está indexada — nada de afirmar «gratis»
    // cuando no lo es).
    heroSub:
      "Historias románticas oscuras y series cortas — escritas, producidas y estrenadas bajo un mismo techo.",
    heroSubFree:
      "Historias románticas oscuras y series cortas — escritas, producidas y estrenadas bajo un mismo techo. Míralo todo gratis.",
    heroAlt: "Fotograma de una producción de Matio",
    browseCta: "Explorar el catálogo",
    pressCta: "Prensa y partners",
    missionLabel: "Nuestra misión",
    missionHeading:
      "Creamos historias románticas oscuras y series cortas usando más de 12 herramientas de IA.",
    missionBody:
      "Todo el proceso — del guion al fotograma final — ocurre dentro del equipo, sin intermediarios y sin comprometer la calidad.",
    missionAlt: "Still de producción de Matio",
    visionLabel: "Nuestra visión",
    visionHeading:
      "La producción con IA no es un atajo: es un nuevo instrumento para el cine de autor.",
    visionBody:
      "La tecnología libera al equipo del trabajo rutinario y nos da más tiempo para la historia, la atmósfera y los personajes. Nuestra meta es ser un estudio cuyas series se reconozcan por un solo fotograma, no por un título.",
    visionAlt: "Still de producción de Matio",
    manifestLine1: "Atrapa al espectador desde la primera escena.",
    manifestLine2: "No lo sueltes hasta el final.",
    manifestCaption: "EL PRINCIPIO QUE SOSTIENE CADA EPISODIO",
    // El principio «nunca pagan» solo puede imprimirse mientras el sitio es
    // gratuito; en modo de pago la lista se reduce a tres.
    principlesFree: [
      "La historia la decide la idea, no el presupuesto",
      "Cada detalle sirve a la atmósfera",
      "Los espectadores nunca pagan",
      "Hacemos lo que nosotros mismos querríamos ver",
    ],
    principlesPaid: [
      "La historia la decide la idea, no el presupuesto",
      "Cada detalle sirve a la atmósfera",
      "Hacemos lo que nosotros mismos querríamos ver",
    ],
    teamLabel: "El equipo",
    teamHeading1: "El equipo que hace",
    teamHeading2: "que cada escena atrape",
    teamSub: (n: number) =>
      `${n} PERSONAS · UN MISMO TECHO · DEL GUION AL FOTOGRAMA FINAL`,
    teamPrev: "Anterior",
    teamNext: "Siguiente",
    pressBannerKicker: "¿Periodista o partner?",
    pressBannerHeading: "Boilerplate, stills y datos — en la página de prensa.",
    pressBannerCta: "Ir a la página de prensa",
    bodyWho:
      "Matio es un proyecto de DEEP ORDINARY LTD, sociedad registrada en Inglaterra y Gales (n.º 17381666).",
  },
  press: {
    metaTitle: "Prensa — Matio",
    metaDescription:
      "Sala de prensa de Matio: boilerplate, kit de prensa con marcas y stills, y contacto para entrevistas y screeners.",
    kicker: "Matio · Prensa y partners",
    title1: "Sala de",
    title2: "prensa.",
    boilerplate:
      "Matio es un estudio independiente que crea historias románticas oscuras y series cortas con más de 12 herramientas de IA. Todo el proceso — del guion al fotograma final — ocurre dentro del equipo. Matio es un proyecto de DEEP ORDINARY LTD, sociedad registrada en Inglaterra y Gales (n.º 17381666).",
    boilerplateFree:
      "Matio es un estudio independiente que crea historias románticas oscuras y series cortas con más de 12 herramientas de IA. Todo el proceso — del guion al fotograma final — ocurre dentro del equipo. Cada episodio se puede ver gratis. Matio es un proyecto de DEEP ORDINARY LTD, sociedad registrada en Inglaterra y Gales (n.º 17381666).",
    boilerplateNote: "USA ESTE PÁRRAFO TAL CUAL COMO BOILERPLATE.",
    kitKicker: "Kit de prensa",
    kitHeading: "Todo en una carpeta.",
    kitBody:
      "Marcas, wordmark y stills de producción — listos para uso editorial.",
    kitDownload: "Descargar el kit · ZIP",
    cardLogomark: "Logomark",
    cardLogomarkMeta: "PNG",
    cardWordmark: "Wordmark",
    cardWordmarkMeta: "PNG",
    cardStills: "Stills",
    cardStillsMeta: "4 × JPEG",
    usageLabel: "Uso —",
    usageBody:
      "la marca dorada solo sobre espresso o rojo de marca. No la recolorees, contornees ni rotes.",
    contactKicker: "Contacto de prensa",
    contactBody:
      "Entrevistas, screeners, stills más allá del kit — respondemos en dos días laborables.",
    websiteAria: "Sitio web",
    logomarkAlt: "Logomark de Matio",
    wordmarkAlt: "Wordmark de Matio",
    stillsAlt: "Still de producción de Matio",
  },
  footer: {
    sectionLegal: "Legal",
    sectionMatio: "matio",
    terms: "Términos del servicio",
    privacy: "Política de privacidad",
    cookies: "Política de cookies",
    cookiePreferences: "Preferencias de cookies",
    contact: "Contacto",
    browse: "Explorar",
    about: "Acerca de",
    press: "Prensa",
    subscribe: "Suscribirse",
    manage: "Gestionar suscripción",
    followUs: "Síguenos",
    tagline: "Mundos de historias. Un estudio.",
    copyright: (year: number) => `© ${year} matio · DEEP ORDINARY LTD`,
  },
  cookieBanner: {
    title: "Cookies en matio",
    body: "Usamos cookies esenciales para que el servicio funcione y cookies de marketing para entender qué campañas funcionan. Tú decides.",
    learnMore: "Más información",
    acceptAll: "Aceptar todas",
    essentialOnly: "Solo esenciales",
  },
  legal: {
    backHome: "Volver al inicio",
    lastUpdated: (date: string) => `Última actualización: ${date}`,
    termsTitle: "Términos del servicio",
    privacyTitle: "Política de privacidad",
    cookiesTitle: "Política de cookies",
    termsDescription:
      "Términos del servicio de Matio: uso de la plataforma, cuentas, contenido y facturación.",
    privacyDescription:
      "Cómo Matio recoge, usa y protege tus datos personales, y qué derechos tienes.",
    cookiesDescription:
      "Qué cookies usa Matio, para qué sirven y cómo gestionar tu consentimiento.",
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
    menuAria: "Open menu",
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
    continueWatching: "Continue watching",
    top3: "Top 3 in Spain",
    newBadge: "New",
    epShort: (n: number) => `Ep. ${n}`,
  },
  hero: {
    matioOriginal: "Matio Original",
    play: "Play",
    moreInfo: "More info",
    watchFree: "Watch free",
    premiereBadge: "Original · Premiere",
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
    breadcrumbHome: "Home",
    shareAria: "Share",
    watchOnlineTitle: (title: string) => `${title} — Watch online`,
    synopsisFallback: (title: string, genre: string[]) =>
      `${title}: an original Matio series${
        genre.length ? ` · ${genre.join(", ")}` : ""
      }. Watch it on subscription streaming.`,
    // Payments-off variant (lib/free-mode.ts): no subscription to sell.
    synopsisFallbackFree: (title: string, genre: string[]) =>
      `${title}: an original Matio series${
        genre.length ? ` · ${genre.join(", ")}` : ""
      }. Watch it free online.`,
    castTitle: "Virtual actors",
    castAs: (c: string) => `as ${c}`,
    castViewProfile: "View profile →",
  },
  actorPage: {
    notFound: "Not found",
    virtualActor: "Virtual actor",
    appearsIn: "Appears in",
    noShowsYet: "Not in any shows yet.",
    metaTitle: (name: string) => `${name} — Virtual actor`,
    metaDescription: (name: string) =>
      `${name}: a Matio virtual actor. Bio and the shows they appear in.`,
  },
  watch: {
    comingSoonTitle: "Coming soon",
    noEpisodesReady: "No episodes ready yet.",
    backToShowAria: "Back to show",
    loading: "Loading",
    rateLimitedKicker: "Too many previews",
    rateLimitedTitle: "Take a breather before the next one.",
    rateLimitedBody:
      "We cap previews for an hour so they don't quietly become full viewings. Subscribe to keep watching without limits.",
    rateLimitedSubscribe: "Subscribe",
    rateLimitedBack: "Back to catalog",
    unavailableKicker: "Playback unavailable",
    unavailableTitle: "We couldn't load this episode.",
    unavailableBody:
      "Looks like a hiccup on our side. Give it another try in a moment.",
    unavailableRetry: "Try again",
    unavailableBack: "Back to show",
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
    prevAria: "Previous episode",
    nextAria: "Next episode",
    shareAria: "Share",
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
    playPreview: "Watch 60s free",
    playFreeEpisode: "Watch free",
    fullscreenAria: "Toggle fullscreen",
    tapForSound: "Tap for sound",
  },
  episodesOverlay: {
    title: "Episodes",
    closeAria: "Close",
    season: (n: number) => `Season ${n}`,
    nowPlaying: "Now playing",
    minutes: (m: number) => `${m} min`,
    count: (n: number) =>
      n === 1 ? `${n} episode` : `${n} episodes`,
    lockedSignup: "Create account",
    lockedSubscribe: "Subscribe",
    lockedAria: "Locked episode",
  },
  upNextOverlay: {
    label: "Up next",
    watchNow: "Watch now",
    cancel: "Cancel",
    playingIn: (s: number) => `Playing in ${s}s`,
  },
  seriesEndOverlay: {
    label: "Next episode reminder",
    kicker: "That's all · for now",
    headline: (showTitle: string) =>
      `Thanks for watching ${showTitle}.`,
    body: "The next episode is in production and will be out soon. Leave your email and we'll let you know the moment it drops.",
    emailLabel: "Email",
    emailPlaceholder: "you@email.com",
    submitCta: "Notify me",
    submitting: "Saving…",
    successBody: "You're on the list. We'll let you know the moment it drops.",
    closeCta: "Close",
    dismissAria: "Dismiss reminder",
    privacyNote: "We'll only use this to tell you about the next episode.",
    errorInvalidEmail: "That email doesn't look right. Try again?",
    errorRateLimited:
      "Too many attempts from your network. Try again in a bit.",
    errorGeneric: "Something went wrong. Please try again.",
  },
  unsubscribe: {
    metaTitle: "Unsubscribe",
    heading: "Unsubscribe",
    confirmBody: (email: string) =>
      `Stop receiving new-episode notifications for ${email}?`,
    confirmCta: "Yes, unsubscribe",
    doneHeading: "Done",
    doneBody:
      "We've removed your email. You won't get any more episode notifications.",
    invalidHeading: "Invalid link",
    invalidBody:
      "This unsubscribe link isn't valid. Email contact@matio.tv and we'll take care of it.",
    backHome: "Back to home",
  },
  paywall: {
    previewComplete: "Preview complete",
    continueWatching: "Continue watching",
    yourStory: "Your story",
    pickUpWhereLeftOff: "Pick up where you left off.",
    signUpToContinue: "Create a free account to keep watching.",
    signUpCta: "Sign up",
    payFirstBody:
      "Watch 3 days for $1, then $38/mo. We set up your account from your checkout email, and you can cancel anytime.",
    payFirstCta: "Try it · $1 for 3 days",
    alreadyMember: "Already have an account?",
    signInLink: "Sign in",
    continuingToCheckout: "Continuing to checkout…",
    continueSubscribe: "Continue · Subscribe",
    cancelAnytimeFromAccount: "Cancel anytime from your account.",
    allFreeWatched: "Free episodes complete",
    subscribeBody:
      "Subscribe to watch the full catalog and every upcoming episode.",
    benefits: "Every episode · Full catalog · Cancel anytime",
    openInBrowserHeading: "Open in your browser",
    openInBrowserIos:
      'To pay and sign in without issues, tap ••• above and choose "Open in Safari" — or copy the link and paste it into your browser.',
    openInBrowserAndroid: "To pay and sign in without issues, open it in Chrome.",
    openInBrowserAndroidCta: "Open in Chrome",
    openInBrowserCopy: "Copy link",
    openInBrowserCopied: "Link copied",
    openInBrowserDismiss: "Dismiss",
  },
  signupWall: {
    kicker: "Keep watching free",
    freeComplete: "Free episodes watched",
    headline: "Create your account",
    headlineFallback: "Your story",
    body: (n: number) =>
      n === 1
        ? `Create a free account and instantly unlock ${n} more episode.`
        : `Create a free account and instantly unlock ${n} more episodes.`,
    bodyNoCount:
      "Create a free account to keep watching and save your progress across every series.",
    gateKicker: "Watch for free",
    gateBody:
      "Create a free account to start watching and save your progress across every series.",
    signUpCta: "Create free account",
    alreadyMember: "Already have an account?",
    signInLink: "Sign in",
    noCardNeeded: "No card needed. Just an email.",
  },
  subscribe: {
    membershipKicker: "Membership",
    membershipHeadline: "Become a member.",
    watchEverything: "Watch everything.",
    cancelAnytimeAll: "Cancel anytime. All originals included.",
    monthly: "Membership",
    monthlyPrice: "$1",
    monthlyInterval: "3 days",
    monthlySub: "Then $38/month · cancel anytime",
    secureCheckout: "Secure checkout via Stripe",
    cancelInOneClick: "Cancel in one click",
    fourKWhenAvailable: "4K when available",
    redirectingToCheckout: "Redirecting to checkout…",
    continueSubscribe: "Continue · Subscribe",
    withdrawalWaiver:
      "I request that matio begin streaming immediately and I acknowledge that I lose my 14-day right of withdrawal once playback starts.",
    alreadyMemberKicker: "Already a member",
    youreSubscribed: "You're subscribed.",
    yourPlanIs: (plan: string, status: string) =>
      `Your ${plan} plan is ${status}. Change or cancel any time in your account.`,
    manageSubscription: "Manage subscription",
    backToBrowse: "Back to browse",
  },
  checkout: {
    kicker: "Secure checkout",
    title: "Complete your membership.",
    back: "Back",
    loading: "Loading secure checkout…",
    errorBody: "We couldn't load checkout. Please try again.",
    retry: "Try again",
  },
  welcome: {
    kicker: "Membership active",
    title: "Welcome to matio.",
    signingIn: "Signing you in…",
    ready: "You're all set.",
    watchNow: "Watch now",
    accountEmail: (maskedEmail: string) =>
      `Your membership is linked to ${maskedEmail}.`,
    signInToWatch:
      "Sign in with that email to start watching — we'll send you a code.",
    ticketFailed:
      "We couldn't sign you in automatically. Sign in with the email you used at checkout.",
    claimPending:
      "Your payment went through and your account is activating. Sign in with the email you used at checkout, or reopen this link in a moment.",
    emailLabel: "Email address",
    emailPlaceholder: "you@email.com",
    sendCodeCta: "Send code",
    sendingCode: "Sending…",
    codeSentTo: (email: string) =>
      `We sent a code to ${email}. Check your spam folder too.`,
    codeLabel: "Verification code",
    codePlaceholder: "6-digit code",
    verifyCta: "Verify & sign in",
    verifying: "Verifying…",
    resendCta: "Resend code",
    changeEmail: "Change email",
    codeSendFailed:
      "We couldn't send the code. Check the email or open this page in your browser.",
    codeWrong: "Wrong or expired code. Please try again.",
    wrongEmail: "Wrong email? Contact contact@matio.tv",
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
    // Payments-off variants (lib/free-mode.ts): the indexed copy must not
    // promise a subscription gate or a 60s preview that no longer exists.
    siteDescriptionFree:
      "A streaming home for original short-form stories. The full catalogue, free.",
    twitterTitle: "matio",
    twitterDescription:
      "Original stories, streamed. Watch the first 60 seconds free.",
    twitterDescriptionFree:
      "Original stories, streamed. The full catalogue, free.",
  },
  og: {
    kicker: "Streaming originals",
    title: ["Original stories,", "streamed."],
    tagline: "Watch the first 60 seconds free.",
    taglineFree: "Watch everything free.",
  },
  about: {
    metaTitle: "About Matio",
    metaDescription:
      "Matio is an independent studio: dark romantic stories and short series made with more than 12 AI tools, from script to final frame.",
    heroBadge: "About matio",
    heroTitle1: "Story worlds.",
    heroTitle2: "One studio.",
    // The "free" variant appends the free-to-watch sentence; with payments on
    // the neutral one renders (the page is indexed — never claim "free" when
    // it isn't).
    heroSub:
      "Dark romantic stories and short series — written, produced and premiered under one roof.",
    heroSubFree:
      "Dark romantic stories and short series — written, produced and premiered under one roof. Free to watch.",
    heroAlt: "Still frame from a Matio production",
    browseCta: "Browse the catalogue",
    pressCta: "Press & partners",
    missionLabel: "Our mission",
    missionHeading:
      "We create dark romantic stories and short series using more than 12 AI tools.",
    missionBody:
      "The entire process — from script to final frame — happens within the team, with no intermediaries and no compromises on quality.",
    missionAlt: "Matio production still",
    visionLabel: "Our vision",
    visionHeading:
      "AI production isn't a shortcut — it's a new instrument for authorial filmmaking.",
    visionBody:
      "Technology frees the team from routine work and gives us more time for story, atmosphere, and character. Our goal is to become a studio whose series are recognized from a single frame, not from a title.",
    visionAlt: "Matio production still",
    manifestLine1: "Grab the viewer from the first scene.",
    manifestLine2: "Never let go until the end.",
    manifestCaption: "THE ONE PRINCIPLE EVERY EPISODE IS BUILT AROUND",
    // The "never pay" principle can only be printed while the site is free;
    // in paid mode the list drops to three.
    principlesFree: [
      "A story is decided by the idea, not the budget",
      "Every detail serves the atmosphere",
      "Viewers never pay",
      "We make what we'd want to watch ourselves",
    ],
    principlesPaid: [
      "A story is decided by the idea, not the budget",
      "Every detail serves the atmosphere",
      "We make what we'd want to watch ourselves",
    ],
    teamLabel: "The team",
    teamHeading1: "The team that makes",
    teamHeading2: "every scene grip",
    teamSub: (n: number) => `${n} PEOPLE · ONE ROOF · SCRIPT TO FINAL FRAME`,
    teamPrev: "Previous",
    teamNext: "Next",
    pressBannerKicker: "Journalist or partner?",
    pressBannerHeading: "Boilerplate, stills and facts — on the press page.",
    pressBannerCta: "Visit the press page",
    bodyWho:
      "Matio is a project by DEEP ORDINARY LTD, registered in England and Wales (company no. 17381666).",
  },
  press: {
    metaTitle: "Press — Matio",
    metaDescription:
      "Matio press room: boilerplate, a press kit with marks and stills, and a contact for interviews and screeners.",
    kicker: "Matio · Press & partners",
    title1: "Press",
    title2: "room.",
    boilerplate:
      "Matio is an independent studio making dark romantic stories and short series with more than 12 AI tools. The entire process — from script to final frame — happens within the team. Matio is a project by DEEP ORDINARY LTD, registered in England and Wales (company no. 17381666).",
    boilerplateFree:
      "Matio is an independent studio making dark romantic stories and short series with more than 12 AI tools. The entire process — from script to final frame — happens within the team. Every episode is free to watch. Matio is a project by DEEP ORDINARY LTD, registered in England and Wales (company no. 17381666).",
    boilerplateNote: "USE THIS PARAGRAPH VERBATIM AS BOILERPLATE.",
    kitKicker: "Press kit",
    kitHeading: "Everything in one folder.",
    kitBody: "Marks, wordmark and production stills — cleared for editorial use.",
    kitDownload: "Download the kit · ZIP",
    cardLogomark: "Logomark",
    cardLogomarkMeta: "PNG",
    cardWordmark: "Wordmark",
    cardWordmarkMeta: "PNG",
    cardStills: "Stills",
    cardStillsMeta: "4 × JPEG",
    usageLabel: "Usage —",
    usageBody:
      "gold mark on espresso or brand red only. Don't recolour, outline or rotate it.",
    contactKicker: "Press contact",
    contactBody:
      "Interviews, screeners, stills beyond the kit — we answer within two working days.",
    websiteAria: "Website",
    logomarkAlt: "Matio logomark",
    wordmarkAlt: "Matio wordmark",
    stillsAlt: "Matio production still",
  },
  footer: {
    sectionLegal: "Legal",
    sectionMatio: "matio",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    cookies: "Cookie Policy",
    cookiePreferences: "Cookie preferences",
    contact: "Contact",
    browse: "Browse",
    about: "About",
    press: "Press",
    subscribe: "Subscribe",
    manage: "Manage subscription",
    followUs: "Follow us",
    tagline: "Story worlds. One studio.",
    copyright: (year: number) => `© ${year} matio · DEEP ORDINARY LTD`,
  },
  cookieBanner: {
    title: "Cookies on matio",
    body: "We use essential cookies to run the service and marketing cookies to learn which campaigns are working. Your call.",
    learnMore: "Learn more",
    acceptAll: "Accept all",
    essentialOnly: "Essential only",
  },
  legal: {
    backHome: "Back to home",
    lastUpdated: (date: string) => `Last updated: ${date}`,
    termsTitle: "Terms of Service",
    privacyTitle: "Privacy Policy",
    cookiesTitle: "Cookie Policy",
    termsDescription:
      "Matio's Terms of Service: using the platform, accounts, content and billing.",
    privacyDescription:
      "How Matio collects, uses and protects your personal data, and the rights you have.",
    cookiesDescription:
      "The cookies Matio uses, what they are for and how to manage your consent.",
  },
};

export const DICTS = { es, en } as const;

export function dictFor(locale: Locale): Dict {
  return locale === "en" ? en : es;
}
