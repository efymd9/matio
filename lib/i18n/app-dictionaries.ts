// Copy that exists ONLY in the mobile app — sign-in steps the web delegates
// to Clerk's modal, the forced-update screen, the app's own load/reachability
// errors, the native shell's tab titles / Browse / Account / Settings (#245)
// and the Home feed's two strings (#248). Everything the web already says (rails, walls, player labels,
// durations, legal links, the sign-up wall) the app reads straight from
// dictionaries.ts; nothing is copied. English only, like the rest of the app
// since #447 (2026-10-12).
//
// A separate file rather than an `app` section in dictionaries.ts for the
// same reason admin-dictionaries.ts is separate: dictionaries.ts ships in the
// web's client bundle, and these strings never render there. Universal — no
// imports at all — so Metro can bundle it (mobile/src/shared/i18n.ts
// re-exports it).

export const appEn = {
  common: {
    loadFailed: "Couldn't load Matio",
    unreachable: "Couldn't reach Matio",
    showLoadFailed: "Couldn't load this show",
    notNow: "Not now",
    pleaseWait: "Please wait…",
    // The show page's «‹» to VoiceOver (#288), and the visible way out of an
    // error on a pushed screen (#292).
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
    // Spoken only (VoiceOver): the search field's «×» (#288).
    clearSearch: "Clear search",
  },
  // The Home feed under the carousel (#248): the signed-in «Up next» block and
  // its resume pill. Everything else the feed prints — Just released, Popular
  // now, New, Ep. n, Play, minutes, the episode count, the tagline — is the
  // web's copy, read straight from dictionaries.ts.
  home: {
    upNext: "Up next",
    resume: "Resume",
  },
  account: {
    member: "Member",
    signOut: "Sign out",
    whyKicker: "Your progress, on every device",
    whyBody: "Pick up where you left off — on matio.tv too.",
    // Clerk would not load — a vendor error, no network, an outage (#253).
    stalledTitle: "Sign-in is unavailable right now",
    stalledBody: "Check your connection and try again.",
    // The sign-out confirmation and its failure (#292) — getting back in
    // costs an email round trip, so one stray tap must not end the session.
    signOutConfirmTitle: "Sign out?",
    signOutConfirmBody: "To sign back in, we'll email you a code.",
    signOutFailed: "Couldn't sign out",
    // «Delete account» (#309, App Store 5.1.1(v)): two confirmations — what is
    // erased and what happens to a subscription, then that it is final — and
    // the failure, which keeps the session so the row can be tapped again.
    deleteAccount: "Delete account",
    deleteConfirmTitle: "Delete your account?",
    deleteConfirmBody:
      "Your account, your watch progress and your new-episode reminders will be erased. If you have an active subscription, it's cancelled at the end of the current billing period and you won't be charged again.",
    deleteFinalTitle: "This can't be undone",
    deleteFinalBody:
      "Your account is deleted for good — we can't restore it, and signing up again starts from scratch.",
    deleteFinalCta: "Delete permanently",
    deleteFailed: "Couldn't delete your account",
    // The session ended on its own before a deletion request could carry it
    // (#398): nothing was erased, and deleting takes a new sign-in.
    deleteSessionEndedTitle: "Your session has ended",
    deleteSessionEndedBody: "Your account was not deleted. Sign in again to delete it.",
    // An account that signed in with Apple (#407, the owner's option (а)):
    // Apple's sheet sits between the two confirmations. The first one warns
    // it is coming; a dismissed sheet stops the deletion, calmly; a sheet that
    // could not give a code (an error, its deadline, another Apple Account's
    // code) leads to the final confirmation with the Apple consequence
    // spelled out — as does an Apple account deleted on Android (no sheet).
    deleteConfirmAppleNote:
      "Next, Apple asks you to Sign in with Apple once more — continue, so Matio is disconnected from your Apple Account too.",
    deleteAppleCancelledTitle: "Your account is still here",
    deleteAppleCancelledBody: "Nothing was deleted. You can try again whenever you like.",
    deleteFinalBodyAppleFailed:
      "Sign in with Apple didn't go through, so Matio stays connected to your Apple Account — you can remove it yourself in Settings, under Sign in with Apple. Your Matio account is still deleted for good and can't be restored.",
  },
  settings: {
    playback: "Playback",
    autoplayNext: "Play next episode automatically",
    autoplayHint: "Applies to horizontal shows; vertical feeds always continue.",
    version: "Version",
  },
  update: {
    title: "Update Matio",
    body: "This version is out of date and can no longer play. Please update to keep watching.",
    // Opens TestFlight (#292) — the app is not in the App Store yet.
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
    // Clerk's answers, which it only gives in English (#288): the form maps
    // their codes here and never shows Clerk's own text.
    codeIncorrect: "Incorrect code.",
    codeExpired: "This code has expired. Request a new one.",
    codeFailed: "Too many failed attempts. Request a new code.",
    tooManyRequests: "Too many requests. Please try again in a moment.",
    // The code step's resend link and its cooldown (#292).
    resend: "Resend code",
    resendIn: (seconds: number) => `Resend code in ${seconds}s`,
    // The form after «Already have an account? Sign in» (#292): the same
    // email → code flow, worded for a returning member, and the way back.
    signInHeadline: "Sign in",
    signInBody: "We'll email you a code. No password needed.",
    noAccount: "No account yet?",
    createAccount: "Create account",
    // The wall and the sign-in form in front of a subscribers-only episode
    // (#462, `paywallNext`): an account will not open it, so nothing says
    // "free" — and, the app selling nothing (App Store 3.1.1), nothing names
    // a purchase, a price or a membership either. No kicker, no "No card
    // needed"; the wall's CTA is `createAccount`.
    paywallNextBody: "Sign in or create an account to continue.",
    // The line under the email step's CTA (#312, App Store 5.1.1(i)): split
    // around its two links, which open /terms and /privacy as Settings does.
    // Legal copy: merged only on the owner's approval in #312's PR thread;
    // counsel review pending together with /terms and /privacy (#168).
    consentBefore: "By continuing you agree to the ",
    consentTerms: "Terms",
    consentMiddle: " and acknowledge the ",
    consentPrivacy: "Privacy Policy",
    // Apple / Google under the email form (#277, board variant B). The
    // Apple button's words are drawn by iOS itself; Google's are its brand
    // guide's own. The two failures are ours: a flow that broke, and an
    // account the provider created without an address (an Apple ID with no
    // shared email) — Clerk's own text is never shown.
    orContinueWith: "or continue with",
    continueWithGoogle: "Continue with Google",
    socialFailed: "Couldn't sign you in. Try again or use your email.",
    socialIncomplete: "We didn't get your email address. Continue with your email instead.",
  },
  watch: {
    subscribersOnly: "Subscribers only",
    subscribersOnlyHint: "This episode needs an active subscription.",
  },
  // Spoken only (VoiceOver): the vertical player's play/pause state — its
  // value, read after «Play / Pause» (#304).
  player: {
    playing: "Playing",
    paused: "Paused",
    // The landscape player's glass chrome (#375, board E «Стекло»). Its other
    // words — Play, ±10 s, Next episode, Episodes, Skip intro, Up next,
    // Watch now, Cancel, Now playing — are the web player's, read from
    // dictionaries.ts. `pause` is the gold pill's label while playing.
    pause: "Pause",
    // Spoken only: the picture-in-picture button, and the scrub bar — its
    // name and its value («6:12 of 16:00»).
    pip: "Picture in Picture",
    // Spoken only: the AirPlay button left of it (#451, iOS only) — Apple's
    // name for the feature, as the system's own button says it.
    airplay: "AirPlay",
    position: "Playback position",
    positionValue: (elapsed: string, total: string) => `${elapsed} of ${total}`,
    // Under the ±10 mark a double tap leaves on screen.
    tenSeconds: "10 sec",
    // Spoken only: the picture's middle once the chrome has hidden itself —
    // what Switch Control / Full Keyboard Access / Voice Control can reach.
    showControls: "Show player controls",
  },
};

export type AppDict = typeof appEn;

