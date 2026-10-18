// String dictionaries for the public surface (catalog, watch, subscribe,
// errors) — and, since the Expo app reads the same copy, for the app too.
// Admin pages are NOT covered here — the admin panel has its own separate
// ru/en system in admin-dictionaries.ts (Russian default, own admin_locale
// cookie) that never affects the visitor-facing language.
//
// English only: the website since #445, the Expo app since #447
// (2026-10-12). The site renders `en` through getDict() / useT(); the app
// through its own useT() (mobile/src/i18n/locale.ts, via
// mobile/src/shared/i18n.ts). Bringing a second language back is a task of
// its own, not a switch.

// `Dict` is structurally defined by the English dictionary. Functions stay
// typed (parameter + return type are inferred via `typeof en`).
export type Dict = typeof en;

export const en = {
  htmlLang: "en",
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
    rateAria: "Playback speed",
    episodesBtn: "Episodes",
    upNextBtn: "Up Next",
    qualityAria: "Video quality",
    // The legacy 60s preview's poster label — the player's trial mode only,
    // which no page renders since #462.
    playPreview: "Watch 60s free",
    playFreeEpisode: "Watch free",
    play: "Play",
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
  forkOverlay: {
    label: "Your call",
    autoTag: "Auto",
    chosenTag: "Chosen",
    autoIn: (s: number) => `Auto in ${s}s`,
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
      "This unsubscribe link isn't valid. Email maksym@matio.tv and we'll take care of it.",
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
      "$25/mo. We set up your account from your checkout email, and you can cancel anytime.",
    payFirstCta: "Become a member · $25/mo",
    alreadyMember: "Already have an account?",
    signInLink: "Sign in",
    continuingToCheckout: "Continuing to checkout…",
    continueSubscribe: "Continue · Subscribe",
    cancelAnytimeFromAccount: "Cancel anytime from your account.",
    allFreeWatched: "Free episodes complete",
    // The tier paywall's kicker when nothing before the locked episode was
    // free — "Free episodes complete" / "Continue watching" would be untrue.
    becomeMemberKicker: "Become a member",
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
    // Paid mode, the wall in front of a subscriber episode (#462): the
    // account comes first and the paywall right after it, so nothing on the
    // wall may promise "free". It shows no kicker — `headline` already says
    // "Create your account".
    thenPaywallBody:
      "Sign up to continue — then become a member to watch every episode.",
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
    monthlyPrice: "$25",
    monthlyInterval: "month",
    monthlySub: "Charged today · cancel anytime",
    secureCheckout: "Secure checkout via Stripe",
    cancelInOneClick: "Cancel in one click",
    fourKWhenAvailable: "4K when available",
    redirectingToCheckout: "Redirecting to checkout…",
    continueSubscribe: "Continue · Subscribe",
    withdrawalWaiver:
      "I request that matio begin streaming immediately and I acknowledge that I lose my 14-day right of withdrawal once playback starts.",
    // The paywall wallet's one required checkbox (#214): Terms acceptance AND
    // the withdrawal waiver. Split around the links so the component renders
    // /terms and /privacy as anchors. Legal copy: approved by the owner
    // 2026-09-10 (#214); counsel review pending together with /terms.
    walletConsent: {
      beforeTerms: "I agree to the ",
      terms: "Terms of Service",
      afterTerms:
        " and ask matio to start streaming now. I understand I lose my 14-day right of withdrawal once playback starts.",
      privacyBefore: "See our ",
      privacy: "Privacy Policy",
      privacyAfter: ".",
    },
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
    rateLimitedBody: "Too many checkout attempts. Please try again in an hour.",
    expiredBody:
      "This checkout expired because you started a newer one — in another tab, or from the player. Try again to continue here.",
    walletFailed:
      "That wallet payment didn't go through. You can still join with a card.",
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
    wrongEmail: "Wrong email? Contact maksym@matio.tv",
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
      "Original short-form drama series from the Matio studio. Create an account, then become a member to watch every episode.",
    // Payments-off variants (lib/free-mode.ts): the indexed copy must not
    // promise a subscription gate or a 60s preview that no longer exists.
    siteDescriptionFree:
      "A streaming home for original short-form stories. The full catalogue, free.",
    twitterTitle: "matio",
    twitterDescription:
      "Original stories, streamed. Create an account, then become a member.",
    twitterDescriptionFree:
      "Original stories, streamed. The full catalogue, free.",
  },
  og: {
    kicker: "Streaming originals",
    title: ["Original stories,", "streamed."],
    tagline: "Become a member. Watch everything.",
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
    careers: "Careers",
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
